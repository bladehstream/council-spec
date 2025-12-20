import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  runEnhancedPipeline,
  parseStageSpec,
  createAgentFromSpec,
  listProviders,
  loadModelsConfig,
  parseAgentSpec,
  parseSectionedOutput,
  getPreset,
  buildPipelineConfig,
  PASS1_SECTIONS,
  PASS2_SECTIONS,
  type PipelineResult,
  type EnhancedPipelineConfig,
  type CheckpointOptions,
  type AgentConfig,
  type TwoPassConfig,
  type ParsedSection,
} from 'agent-council';
import type { InterviewOutput, CouncilOutput, Config, Ambiguity } from './types.js';
import { formatList } from './utils.js';
import { smartParseChairmanOutput, sectionsToMap } from './json-parser.js';

// Note: The two-pass chairman uses default prompts from agent-council.
// Pass 1 produces: executive_summary, ambiguities, consensus_notes, implementation_phases, section_outlines
// Pass 2 produces: architecture, data_model, api_contracts, user_flows, security, deployment
// Both passes use sectioned format (===SECTION:name=== ... ===END:name===) for robust parsing.

/**
 * Interface for the structured chairman output
 */
interface ChairmanStructuredOutput {
  executive_summary: string;
  ambiguities: Array<{
    id: string;
    question: string;
    priority: 'critical' | 'important' | 'minor';
    context: string;
    options: string[];
    recommendation: string;
  }>;
  spec_sections: {
    architecture: string;
    data_model: string;
    api_contracts: string;
    user_flows: string;
    security: string;
    deployment: string;
  };
  implementation_phases: Array<{
    phase: number;
    name: string;
    description: string;
    key_deliverables: string[];
  }>;
  consensus_notes: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

function getActiveLogFile(): string | null {
  const convDir = join(ROOT, 'state', 'conversations');
  if (!existsSync(convDir)) return null;

  const files = readdirSync(convDir)
    .filter(f => f.endsWith('.log'))
    .sort()
    .reverse();

  return files[0] ? join(convDir, files[0]) : null;
}

function log(message: string): void {
  const logFile = getActiveLogFile();
  if (logFile) {
    appendFileSync(logFile, message + '\n');
  }
}

// #region DEBUG_LOGGING - Remove this region to disable verbose logging
const DEBUG_LOGGING_ENABLED = true;

function getDebugDir(): string {
  const debugDir = join(ROOT, 'state', 'debug');
  if (!existsSync(debugDir)) {
    mkdirSync(debugDir, { recursive: true });
  }
  return debugDir;
}

function saveDebugDump(filename: string, data: unknown): string {
  if (!DEBUG_LOGGING_ENABLED) return '';
  const debugDir = getDebugDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filepath = join(debugDir, `${timestamp}_${filename}`);
  writeFileSync(filepath, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  return filepath;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen) + `... [truncated, ${str.length} total chars]`;
}

/**
 * Attempt to repair truncated JSON by adding missing closing braces/brackets.
 * This handles the common case where LLMs run out of tokens and don't complete
 * the final closing characters.
 *
 * @returns The repaired JSON string, or null if repair wasn't possible
 */
function repairTruncatedJson(jsonStr: string): string | null {
  // Count open and close braces/brackets
  let openBraces = 0;
  let closeBraces = 0;
  let openBrackets = 0;
  let closeBrackets = 0;
  let inString = false;
  let escapeNext = false;

  for (const char of jsonStr) {
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    switch (char) {
      case '{': openBraces++; break;
      case '}': closeBraces++; break;
      case '[': openBrackets++; break;
      case ']': closeBrackets++; break;
    }
  }

  const missingBraces = openBraces - closeBraces;
  const missingBrackets = openBrackets - closeBrackets;

  // Only attempt repair if we're missing closers (truncation), not openers (corruption)
  if (missingBraces < 0 || missingBrackets < 0) {
    return null; // More closers than openers - corrupted, not truncated
  }

  if (missingBraces === 0 && missingBrackets === 0) {
    return null; // Already balanced, issue is elsewhere
  }

  // Build the repair suffix
  // We need to close brackets before braces if we're in an array context
  // For simplicity, we'll try both orders and see which parses
  const suffix1 = ']'.repeat(missingBrackets) + '}'.repeat(missingBraces);
  const suffix2 = '}'.repeat(missingBraces) + ']'.repeat(missingBrackets);

  // Try the most likely order first (arrays usually close before objects at end)
  for (const suffix of [suffix1, suffix2]) {
    const repaired = jsonStr + suffix;
    try {
      JSON.parse(repaired);
      return repaired;
    } catch {
      // Try the other order
    }
  }

  // If simple suffix didn't work, try a more aggressive approach:
  // Check if we're mid-string and close it first
  if (inString) {
    const closedString = jsonStr + '"';
    for (const suffix of [suffix1, suffix2]) {
      const repaired = closedString + suffix;
      try {
        JSON.parse(repaired);
        return repaired;
      } catch {
        // Continue trying
      }
    }
  }

  return null;
}

function debugLog(message: string): void {
  if (!DEBUG_LOGGING_ENABLED) return;
  log(message);
}
// #endregion DEBUG_LOGGING

function loadConfig(): Config {
  return JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf-8'));
}

interface CouncilPreferences {
  responders?: string;
  evaluators?: string;
  chairman?: string;
  timeout_seconds?: number;
  /** Preset name from agent-council (e.g., 'fast', 'balanced', 'thorough') */
  preset?: string;
}

function loadPreferences(): CouncilPreferences | null {
  const path = join(ROOT, 'state', 'council-preferences.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function getEffectiveCouncilConfig(config: Config): Config['council'] & { preset?: string } {
  const preferences = loadPreferences();
  const modelsConfig = loadModelsConfig();

  // Check for preset (highest priority for bulk settings)
  const presetName = process.env.COUNCIL_PRESET || preferences?.preset;

  if (presetName) {
    // Load preset from agent-council's models.json
    const preset = getPreset(presetName, modelsConfig);
    if (!preset) {
      console.warn(`Warning: Preset '${presetName}' not found, falling back to config.json`);
    } else {
      // Convert preset tiers to stage specs
      // Individual env vars can still override specific parts of the preset
      const chairmanProvider = modelsConfig.defaults?.chairman || 'claude';
      const stage3Tier = preset.stage3?.tier || 'default';
      const defaultChairman = `${chairmanProvider}:${stage3Tier}`;

      return {
        responders: process.env.COUNCIL_RESPONDERS || `${preset.stage1.count}:${preset.stage1.tier}`,
        evaluators: process.env.COUNCIL_EVALUATORS || (preset.stage2 ? `${preset.stage2.count}:${preset.stage2.tier}` : '0:default'),
        chairman: process.env.COUNCIL_CHAIRMAN || defaultChairman,
        timeout_seconds: process.env.COUNCIL_TIMEOUT
          ? parseInt(process.env.COUNCIL_TIMEOUT, 10)
          : preferences?.timeout_seconds
          ?? config.council.timeout_seconds,
        preset: presetName,
        // Pass through two-pass config from preset
        _twoPass: preset.stage3?.twoPass,
      } as Config['council'] & { preset?: string; _twoPass?: TwoPassConfig };
    }
  }

  // Priority: env vars > preferences > config.json
  return {
    responders: process.env.COUNCIL_RESPONDERS
      || preferences?.responders
      || config.council.responders,
    evaluators: process.env.COUNCIL_EVALUATORS
      || preferences?.evaluators
      || config.council.evaluators,
    chairman: process.env.COUNCIL_CHAIRMAN
      || preferences?.chairman
      || config.council.chairman,
    timeout_seconds: process.env.COUNCIL_TIMEOUT
      ? parseInt(process.env.COUNCIL_TIMEOUT, 10)
      : preferences?.timeout_seconds
      ?? config.council.timeout_seconds,
  };
}


function loadInterview(): InterviewOutput {
  const path = join(ROOT, 'state', 'interview-output.json');
  if (!existsSync(path)) {
    console.error('Error: state/interview-output.json not found');
    console.error('Complete the interview phase first.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/**
 * Stage 1 output format schema for structured JSON responses.
 */
const STAGE1_OUTPUT_FORMAT = `You MUST output your response as a JSON object with this exact structure:

{
  "executive_summary": "A 300-500 word summary capturing: key architectural decisions and their rationale, critical technical risks or challenges identified, the most important ambiguities requiring human decision, and your overall confidence level in the recommendations. This summary will be used by the synthesis stage.",
  "architecture": {
    "overview": "High-level system design description",
    "components": [
      {
        "name": "Component name",
        "purpose": "What this component does",
        "technology": "Recommended technology/framework",
        "interfaces": ["List of interfaces it exposes or consumes"]
      }
    ],
    "communication_patterns": "How components interact (REST, events, etc.)",
    "diagrams": "ASCII or textual representation of architecture"
  },
  "data_model": {
    "entities": [
      {
        "name": "Entity name",
        "description": "Purpose of this entity",
        "key_attributes": ["attribute1", "attribute2"],
        "relationships": ["Relationship descriptions"]
      }
    ],
    "storage_recommendations": "Database choices and rationale",
    "data_flow": "How data moves through the system"
  },
  "api_contracts": {
    "style": "REST/GraphQL/gRPC/etc.",
    "endpoints": [
      {
        "method": "HTTP method or operation type",
        "path": "Endpoint path",
        "purpose": "What this endpoint does",
        "request_shape": "Request body structure",
        "response_shape": "Response body structure"
      }
    ],
    "authentication": "Auth mechanism for APIs"
  },
  "user_flows": [
    {
      "name": "Flow name",
      "actor": "Who performs this flow",
      "steps": ["Step 1", "Step 2"],
      "happy_path": "Expected outcome",
      "error_cases": ["Possible failure modes"]
    }
  ],
  "security": {
    "authentication": "Auth strategy and implementation",
    "authorization": "Permission model",
    "data_protection": "Encryption, PII handling",
    "compliance_notes": "GDPR, HIPAA, etc. considerations",
    "threat_model": "Key threats and mitigations"
  },
  "deployment": {
    "infrastructure": "Cloud provider, services",
    "scaling_strategy": "How to handle load",
    "monitoring": "Observability approach",
    "ci_cd": "Deployment pipeline recommendations"
  },
  "ambiguities": [
    {
      "question": "What needs to be clarified",
      "impact": "What this affects if not resolved",
      "suggested_options": ["Option A", "Option B"],
      "recommendation": "Your suggested resolution"
    }
  ],
  "confidence_level": "high|medium|low",
  "key_risks": ["Risk 1 with brief description", "Risk 2"]
}

CRITICAL REQUIREMENTS:
- Output ONLY the JSON object, no markdown code fences, no additional text before or after
- The executive_summary field is REQUIRED and must comprehensively capture your key findings
- All top-level fields are REQUIRED
- Be thorough but concise - this output feeds into subsequent analysis stages
- The JSON must be valid and parseable`;

function buildPrompt(interview: InterviewOutput): string {
  return `You are analyzing requirements for a software project to produce a detailed technical specification.

## Interview Output

### Problem Statement
${interview.problem_statement.summary}
${interview.problem_statement.context ? `\nContext: ${interview.problem_statement.context}` : ''}
${interview.problem_statement.motivation ? `\nMotivation: ${interview.problem_statement.motivation}` : ''}

### Users and Actors
${interview.users_and_actors?.map(u => `- **${u.name}**: ${u.description || 'No description'}`).join('\n') || 'Not specified'}

### Core Functionality
${interview.core_functionality.map(f => `- [${f.priority}] **${f.feature}**: ${f.description || 'No description'}`).join('\n')}

### Constraints
- Tech Stack: ${formatList(interview.constraints?.tech_stack)}
- Timeline: ${interview.constraints?.timeline || 'Not specified'}
- Budget: ${interview.constraints?.budget || 'Not specified'}
- Compliance: ${formatList(interview.constraints?.compliance, 'None specified')}

### Integration Points
${interview.integration_points?.map(i => `- **${i.system}** (${i.type}, ${i.direction}): ${i.notes || 'No notes'}`).join('\n') || 'None specified'}

### Success Criteria
${interview.success_criteria?.map(c => `- ${c}`).join('\n') || 'Not specified'}

### Out of Scope
${interview.out_of_scope?.map(o => `- ${o}`).join('\n') || 'Not specified'}

### Open Questions from Interview
${interview.open_questions?.map(q => `- ${q}`).join('\n') || 'None'}

---

## Your Task

Analyze these requirements comprehensively and produce a structured technical specification covering:

1. **Architecture**: System design, components, and their interactions
2. **Data Model**: Entities, relationships, and storage considerations
3. **API Contracts**: Endpoints/interfaces the system needs
4. **User Flows**: Critical paths through the system
5. **Security**: Authentication, authorization, data protection
6. **Deployment**: Infrastructure, scaling, monitoring

Identify any **ambiguities, contradictions, or missing information** that need human clarification.

**Guidelines:**
- Explain the reasoning behind your recommendations
- Reference industry standards, protocols, or best practices where applicable (do not invent references)
- Indicate confidence level when making assumptions about unspecified requirements
- Prioritize practical, implementable solutions over theoretical ideals
- Be thorough - your analysis will be peer-reviewed and synthesized with other expert analyses

---

## OUTPUT FORMAT

${STAGE1_OUTPUT_FORMAT}`;
}

function hashInterview(interview: InterviewOutput): string {
  return createHash('sha256')
    .update(JSON.stringify(interview))
    .digest('hex')
    .substring(0, 12);
}

/**
 * Build the chairman fallback chain for merge mode spec synthesis.
 * Fallback chain: gemini:heavy → codex:heavy → claude:heavy → fail loudly
 *
 * Large context windows are critical for merging multiple agent responses.
 * - Gemini Pro: 2M context
 * - Codex Max: Large context
 * - Claude Opus: 200K context (smallest, last resort)
 */
function getChairmanFallbackChain(primarySpec: string): AgentConfig[] {
  const { provider } = parseAgentSpec(primarySpec);

  // Full fallback chain prioritizing context window size
  const fallbackOrder = ['gemini', 'codex', 'claude'];

  // Remove the primary provider from fallback chain (it's already the primary)
  const fallbackProviders = fallbackOrder.filter(p => p !== provider);

  // All fallbacks use heavy tier for maximum context
  return fallbackProviders.map(p => createAgentFromSpec(`${p}:heavy`));
}

/**
 * Get primary chairman for merge mode - defaults to gemini:heavy for largest context.
 * Can be overridden via environment or config.
 */
function getMergeChairmanSpec(configChairman: string): string {
  // If explicitly set, use it; otherwise default to gemini:heavy for merge mode
  if (process.env.COUNCIL_CHAIRMAN) {
    return process.env.COUNCIL_CHAIRMAN;
  }

  // For merge mode, default to gemini:heavy (largest context window)
  // unless config explicitly specifies a different chairman
  const { provider, tier } = parseAgentSpec(configChairman);

  // If config specifies non-default tier, respect it
  if (tier !== 'default') {
    return configChairman;
  }

  // Default to gemini:heavy for merge mode
  return 'gemini:heavy';
}

async function runCouncil(prompt: string, config: Config): Promise<void> {
  // Get merge-mode chairman (defaults to gemini:heavy for largest context)
  const mergeChairmanSpec = getMergeChairmanSpec(config.council.chairman);

  console.log('Starting council with configuration:');
  console.log(`  Mode: merge (combining all agent insights)`);
  console.log(`  Responders: ${config.council.responders}`);
  console.log(`  Stage 2: SKIPPED (merge mode)`);
  console.log(`  Chairman: ${mergeChairmanSpec}`);
  console.log(`  Timeout: ${config.council.timeout_seconds}s`);
  console.log('');

  log(`
--- PHASE: COUNCIL (merge mode) ---
[${new Date().toISOString()}]

Config:
  Mode: merge
  Responders: ${config.council.responders}
  Stage 2: SKIPPED (merge mode)
  Chairman: ${mergeChairmanSpec}
  Timeout: ${config.council.timeout_seconds}s

Starting council...
`);

  try {
    // Load models config and get available providers
    const modelsConfig = loadModelsConfig();
    const availableProviders = listProviders(modelsConfig);

    // Parse stage specs from config - only Stage 1 is used in merge mode
    const stage1Spec = parseStageSpec(config.council.responders, availableProviders, modelsConfig);
    // Stage 2 is SKIPPED in merge mode - no ranking/evaluation needed

    // Parse chairman spec - supports granular format: provider:pass1tier/pass2tier
    // Examples: claude:heavy, gemini:heavy/default, claude:default/fast
    // For merge mode, defaults to gemini:heavy for largest context window
    let chairmanSpec = mergeChairmanSpec;
    let chairmanPass1Tier: 'fast' | 'default' | 'heavy' = 'heavy'; // Default to heavy for merge mode
    let chairmanPass2Tier: 'fast' | 'default' | 'heavy' = 'default';
    let hasGranularChairman = false;

    const [chairmanProvider, tierPart] = chairmanSpec.split(':');
    if (tierPart && tierPart.includes('/')) {
      // Granular format: pass1tier/pass2tier
      hasGranularChairman = true;
      const [p1, p2] = tierPart.split('/');
      chairmanPass1Tier = (p1 || 'heavy') as 'fast' | 'default' | 'heavy';
      chairmanPass2Tier = (p2 || 'default') as 'fast' | 'default' | 'heavy';
      // Normalize spec for createAgentFromSpec (use pass1 tier)
      chairmanSpec = `${chairmanProvider}:${chairmanPass1Tier}`;
      console.log(`  Chairman: ${chairmanProvider} (Pass 1: ${chairmanPass1Tier}, Pass 2: ${chairmanPass2Tier})`);
    } else if (tierPart) {
      chairmanPass1Tier = tierPart as 'fast' | 'default' | 'heavy';
      chairmanPass2Tier = tierPart as 'fast' | 'default' | 'heavy';
    }

    const chairman = createAgentFromSpec(chairmanSpec);

    // Build fallback chain for merge mode: gemini:heavy → codex:heavy → claude:heavy → fail
    const fallbackChain = getChairmanFallbackChain(chairmanSpec);
    const primaryFallback = fallbackChain[0]; // First fallback for the pipeline config

    if (fallbackChain.length > 0) {
      console.log(`  Fallback Chain: ${fallbackChain.map(f => f.name).join(' → ')} → fail`);
    } else {
      console.log(`  Fallback Chain: none (all providers used as primary)`);
    }

    // Build two-pass configuration
    // Priority: granular chairman format > preset config > calculated from tier
    const presetTwoPass = (config.council as any)._twoPass as TwoPassConfig | undefined;
    let twoPassConfig: TwoPassConfig;

    if (hasGranularChairman) {
      // Use explicitly specified tiers from chairman spec
      twoPassConfig = {
        enabled: true,
        pass1Tier: chairmanPass1Tier,
        pass2Tier: chairmanPass2Tier,
      };
      // Already logged above
    } else if (presetTwoPass?.enabled) {
      // Use two-pass config from preset
      twoPassConfig = presetTwoPass;
      console.log(`  Two-Pass Mode: Pass 1 (${presetTwoPass.pass1Tier || 'default'}) → Pass 2 (${presetTwoPass.pass2Tier || 'default'}) [from preset]`);
    } else {
      // Calculate from chairman tier with 'default' floor for Pass 2
      const pass2Tier = chairmanPass1Tier === 'heavy' ? 'default' : 'default'; // Floor at 'default'

      twoPassConfig = {
        enabled: true,
        pass1Tier: chairmanPass1Tier,
        pass2Tier: pass2Tier === chairmanPass1Tier ? undefined : pass2Tier as 'fast' | 'default' | 'heavy',
      };
      console.log(`  Two-Pass Mode: Pass 1 (${chairmanPass1Tier}) → Pass 2 (${pass2Tier})`);
    }

    // Build pipeline config with merge mode, two-pass chairman, fallback chain
    const pipelineConfig: EnhancedPipelineConfig = {
      mode: 'merge',  // MERGE MODE: Combine all agent insights, skip Stage 2 ranking
      stage1: { agents: stage1Spec.agents },
      // Stage 2 is omitted - merge mode skips ranking entirely
      stage3: {
        chairman,
        useReasoning: false,
        fallback: primaryFallback,  // First fallback in chain
        useSummaries: true,  // Use executive summaries to reduce chairman context
        twoPass: twoPassConfig,  // Enable two-pass synthesis
      },
    };

    // Checkpoint configuration
    const checkpointOptions: CheckpointOptions = {
      checkpointDir: join(ROOT, 'state', 'checkpoints'),
      checkpointName: 'council-checkpoint',
    };

    // Run the council pipeline with checkpointing and fallback
    const result = await runEnhancedPipeline(prompt, {
      config: pipelineConfig,
      timeoutMs: config.council.timeout_seconds * 1000,
      tty: process.stdout.isTTY ?? false,
      silent: false,
      checkpoint: checkpointOptions,
      callbacks: {
        onStage1Complete: (results) => {
          console.log(`\nStage 1 complete: ${results.length} responses`);
          // #region DEBUG_LOGGING - verbose stage 1 logging
          if (DEBUG_LOGGING_ENABLED) {
            results.forEach((r, i) => {
              const size = r.response?.length || 0;
              console.log(`  [${i + 1}] ${r.agent}: ${size} chars`);
              debugLog(`Stage 1 response ${i + 1} (${r.agent}): ${size} chars`);
            });
            const totalSize = results.reduce((sum, r) => sum + (r.response?.length || 0), 0);
            console.log(`  Total Stage 1 size: ${totalSize} chars`);
            debugLog(`Stage 1 total response size: ${totalSize} chars`);
          }
          // #endregion DEBUG_LOGGING
        },
        // Stage 2 callback - not used in merge mode (no ranking)
        onStage2Complete: (rankings, aggregate) => {
          // This callback won't be invoked in merge mode
          // Kept for backward compatibility if mode is changed
          if (rankings && rankings.length > 0) {
            console.log(`\nStage 2 complete: ${rankings.length} rankings`);
            if (DEBUG_LOGGING_ENABLED) {
              rankings.forEach((r, i) => {
                console.log(`  [${i + 1}] ${r.agent}: ranked ${r.parsedRanking?.join(' > ') || 'parse failed'}`);
                debugLog(`Stage 2 ranking ${i + 1} (${r.agent}): ${r.parsedRanking?.join(' > ') || 'PARSE FAILED'}`);
              });
              if (aggregate) {
                console.log(`  Aggregate scores: ${aggregate.map(a => `${a.agent}=${a.averageRank.toFixed(2)}`).join(', ')}`);
              }
            }
          }
        },
        onStage3Complete: (synthesis) => {
          const size = synthesis?.response?.length || 0;
          console.log(`\nStage 3 complete: Chairman synthesis received (${size} chars)`);
          // #region DEBUG_LOGGING - verbose stage 3 logging
          if (DEBUG_LOGGING_ENABLED) {
            debugLog(`Stage 3 chairman response size: ${size} chars`);
            if (synthesis?.response) {
              const preview = truncate(synthesis.response, 200);
              console.log(`  Preview: ${preview}`);
            }
          }
          // #endregion DEBUG_LOGGING
        },
      },
    });

    if (!result) {
      throw new Error('Council pipeline returned no results');
    }

    // Parse the sectioned output from two-pass chairman
    const rawResponse = result.stage3.response;

    // Check if response looks like an error message first
    if (rawResponse.startsWith('Error') || rawResponse.includes('Error from')) {
      console.error('\n*** CHAIRMAN RETURNED AN ERROR MESSAGE ***');
      console.error('This usually indicates an API error (rate limit, context too long, or service issue)');
      debugLog(`Chairman returned error message: ${rawResponse}`);
      throw new Error(`Chairman returned error: ${rawResponse}`);
    }

    // Parse chairman output using multi-strategy approach:
    // 1. Try sectioned format (===SECTION:name===...===END:name===)
    // 2. If no sections, use smart JSON parser with repair capabilities
    const sections = parseSectionedOutput(rawResponse);
    let sectionMap = new Map(sections.map(s => [s.name, s]));
    let parseMethod = 'sectioned format';

    // If no sections found, use smart JSON parser
    if (sections.length === 0) {
      console.log('\nNo sectioned format found, using smart JSON parser...');
      const smartResult = smartParseChairmanOutput(rawResponse);

      if (smartResult.success) {
        sectionMap = sectionsToMap(smartResult);
        parseMethod = smartResult.method === 'json' ? 'JSON'
          : smartResult.method === 'repaired' ? 'repaired JSON'
          : 'extracted sections';

        console.log(`  Smart parser: ${smartResult.method} (${smartResult.sections.length} sections)`);

        // Log any warnings/repairs
        for (const error of smartResult.errors) {
          console.log(`  Note: ${error}`);
        }
      } else {
        console.warn('  Smart parser failed:', smartResult.errors.join('; '));
        parseMethod = 'failed';
      }
    }

    // Report parsing results
    const completeSections = Array.from(sectionMap.values()).filter(s => s.complete).map(s => s.name);
    const incompleteSections = Array.from(sectionMap.values()).filter(s => !s.complete).map(s => s.name);

    console.log(`\nParsed ${completeSections.length} complete sections from two-pass chairman (${parseMethod})`);
    if (DEBUG_LOGGING_ENABLED) {
      console.log(`  Complete: ${completeSections.join(', ')}`);
      if (incompleteSections.length > 0) {
        console.log(`  Incomplete/truncated: ${incompleteSections.join(', ')}`);
      }
    }

    // Helper to get section content with fallback
    const getSection = (name: string, required = false): string => {
      const section = sectionMap.get(name);
      if (!section) {
        if (required) {
          console.warn(`  Warning: Required section '${name}' not found`);
        }
        return '';
      }
      if (!section.complete) {
        console.warn(`  Warning: Section '${name}' may be truncated`);
      }
      return section.content;
    };

    // Helper to parse JSON section with auto-repair
    const parseJsonSection = <T>(name: string, required = false): T | null => {
      const content = getSection(name, required);
      if (!content) return null;

      try {
        return JSON.parse(content);
      } catch {
        // Try auto-repair for truncated JSON
        const repaired = repairTruncatedJson(content);
        if (repaired) {
          try {
            const parsed = JSON.parse(repaired);
            console.log(`  Note: Section '${name}' JSON was auto-repaired`);
            return parsed;
          } catch {
            // Fall through
          }
        }
        console.warn(`  Warning: Failed to parse JSON in section '${name}'`);
        return null;
      }
    };

    // Extract and parse sections
    const executiveSummary = getSection('executive_summary', true);
    const rawAmbiguities = parseJsonSection<ChairmanStructuredOutput['ambiguities']>('ambiguities', true) || [];
    const consensusNotes = getSection('consensus_notes');
    const implementationPhases = parseJsonSection<ChairmanStructuredOutput['implementation_phases']>('implementation_phases') || [];

    // Extract spec sections (from Pass 2)
    const specSections: ChairmanStructuredOutput['spec_sections'] = {
      architecture: getSection('architecture', true),
      data_model: getSection('data_model', true),
      api_contracts: getSection('api_contracts', true),
      user_flows: getSection('user_flows', true),
      security: getSection('security', true),
      deployment: getSection('deployment', true),
    };

    // Build structured output from sections
    const structuredOutput: ChairmanStructuredOutput = {
      executive_summary: executiveSummary,
      ambiguities: rawAmbiguities,
      spec_sections: specSections,
      implementation_phases: implementationPhases,
      consensus_notes: consensusNotes,
    };

    // Convert structured ambiguities to our Ambiguity type
    const ambiguities: Ambiguity[] = structuredOutput.ambiguities.map((a, idx) => ({
      id: a.id || `AMB-${idx + 1}`,
      description: a.question,
      source: 'divergent_responses' as const,
      options: a.options,
      // Store additional structured data
      priority: a.priority,
      context: a.context,
      recommendation: a.recommendation,
    }));

    const interview = loadInterview();
    const councilOutput: CouncilOutput = {
      input_hash: hashInterview(interview),
      timestamp: new Date().toISOString(),
      mode: 'merge',  // Record the mode used
      stage1: result.stage1.map(s => ({
        agent: s.agent,
        response: s.response,
      })),
      // Stage 2 is skipped in merge mode - no rankings
      stage2: result.stage2 ? {
        rankings: result.stage2.map(s => ({
          agent: s.agent,
          ranking: s.parsedRanking,
        })),
        aggregate: result.aggregate?.map(a => ({
          agent: a.agent,
          score: a.averageRank,
        })) || [],
      } : null,  // Explicitly null in merge mode
      stage3: {
        chairman: result.stage3.agent,
        synthesis: rawResponse,
      },
      ambiguities,
      spec_sections: structuredOutput.spec_sections,
      // Store additional structured data for downstream use
      _structured: {
        executive_summary: structuredOutput.executive_summary,
        implementation_phases: structuredOutput.implementation_phases,
        consensus_notes: structuredOutput.consensus_notes,
      },
    };

    writeFileSync(
      join(ROOT, 'state', 'spec-council-output.json'),
      JSON.stringify(councilOutput, null, 2)
    );

    log(`[${new Date().toISOString()}]
Council complete (merge mode).
Agents used: ${councilOutput.stage1.map(s => s.agent).join(', ') || 'N/A'}
Ambiguities found: ${councilOutput.ambiguities.length}
Output written to state/spec-council-output.json
`);

    console.log('\n\nCouncil complete. Output written to state/spec-council-output.json');
  } catch (error) {
    console.error('Council failed:', error);
    log(`[${new Date().toISOString()}]
Council FAILED: ${error instanceof Error ? error.message : String(error)}
`);
    throw error;
  }
}

// Main
const config = loadConfig();
const effectiveCouncil = getEffectiveCouncilConfig(config);
const effectiveConfig: Config = { ...config, council: effectiveCouncil };

const interview = loadInterview();
const prompt = buildPrompt(interview);

console.log('='.repeat(60));
console.log('SPEC WORKFLOW - Council Phase');
console.log('='.repeat(60));
console.log('');

// Show config source if overridden
const preferences = loadPreferences();
const presetUsed = (effectiveCouncil as any).preset;
if (presetUsed || preferences || process.env.COUNCIL_RESPONDERS || process.env.COUNCIL_EVALUATORS || process.env.COUNCIL_CHAIRMAN) {
  console.log('Config overrides applied:');
  if (presetUsed) console.log(`  COUNCIL_PRESET: ${presetUsed} (from agent-council)`);
  if (process.env.COUNCIL_RESPONDERS) console.log('  COUNCIL_RESPONDERS (env)');
  if (process.env.COUNCIL_EVALUATORS) console.log('  COUNCIL_EVALUATORS (env)');
  if (process.env.COUNCIL_CHAIRMAN) console.log('  COUNCIL_CHAIRMAN (env)');
  if (process.env.COUNCIL_TIMEOUT) console.log('  COUNCIL_TIMEOUT (env)');
  if (preferences && !presetUsed) console.log('  state/council-preferences.json');
  console.log('');
}

runCouncil(prompt, effectiveConfig).catch((err) => {
  console.error('Council failed:', err);
  process.exit(1);
});
