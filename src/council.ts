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
  type PipelineResult,
  type EnhancedPipelineConfig,
} from 'agent-council';
import type { InterviewOutput, CouncilOutput, Config, Ambiguity } from './types.js';
import { formatList } from './utils.js';

/**
 * Structured output format for the chairman.
 * This instructs the chairman to output JSON that can be reliably parsed.
 */
const CHAIRMAN_OUTPUT_FORMAT = `You MUST output your response as a JSON object with this exact structure:

{
  "executive_summary": "2-3 paragraph synthesis of the council's analysis and key recommendations",
  "ambiguities": [
    {
      "id": "AMB-1",
      "question": "Clear question that needs human decision",
      "priority": "critical" | "important" | "minor",
      "context": "Why this matters and what it affects",
      "options": ["Option A description", "Option B description"],
      "recommendation": "Council's recommended choice with rationale"
    }
  ],
  "spec_sections": {
    "architecture": "Detailed architecture recommendations as markdown",
    "data_model": "Data model design including entities, relationships, storage as markdown",
    "api_contracts": "API specifications, endpoints, request/response formats as markdown",
    "user_flows": "Critical user journeys and system interactions as markdown",
    "security": "Security considerations, auth, encryption, compliance as markdown",
    "deployment": "Infrastructure, scaling, monitoring recommendations as markdown"
  },
  "implementation_phases": [
    {
      "phase": 1,
      "name": "Phase name",
      "description": "What this phase accomplishes",
      "key_deliverables": ["Deliverable 1", "Deliverable 2"]
    }
  ],
  "consensus_notes": "Summary of areas where agents agreed/disagreed and how conflicts were resolved"
}

CRITICAL REQUIREMENTS:
- Output ONLY the JSON object, no markdown code fences, no additional text
- Every open question or ambiguity identified MUST appear in the ambiguities array
- All spec_sections fields are REQUIRED - do not omit any
- Priority must be exactly one of: "critical", "important", or "minor"
- Include at least 2-4 implementation phases
- The JSON must be valid and parseable`;

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

function getEffectiveCouncilConfig(config: Config): Config['council'] {
  const preferences = loadPreferences();

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

function buildPrompt(interview: InterviewOutput): string {
  return `You are analyzing requirements for a software project to produce a detailed specification.

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

Analyze these requirements and produce:

1. **Architecture Recommendations**: High-level system design, components, and their interactions
2. **Data Model**: Key entities, relationships, and storage considerations
3. **API Contracts**: Main endpoints/interfaces the system needs
4. **User Flows**: Critical paths through the system
5. **Security Considerations**: Authentication, authorization, data protection
6. **Deployment Strategy**: Infrastructure, scaling, monitoring

Also identify any **ambiguities, contradictions, or missing information** that would need human clarification before implementation.

Be specific and technical. This output will be used to generate a detailed specification.`;
}

function hashInterview(interview: InterviewOutput): string {
  return createHash('sha256')
    .update(JSON.stringify(interview))
    .digest('hex')
    .substring(0, 12);
}

async function runCouncil(prompt: string, config: Config): Promise<void> {
  console.log('Starting council with configuration:');
  console.log(`  Responders: ${config.council.responders}`);
  console.log(`  Evaluators: ${config.council.evaluators}`);
  console.log(`  Chairman: ${config.council.chairman}`);
  console.log(`  Timeout: ${config.council.timeout_seconds}s`);
  console.log('');

  log(`
--- PHASE: COUNCIL ---
[${new Date().toISOString()}]

Config:
  Responders: ${config.council.responders}
  Evaluators: ${config.council.evaluators}
  Chairman: ${config.council.chairman}
  Timeout: ${config.council.timeout_seconds}s

Starting council...
`);

  try {
    // Load models config and get available providers
    const modelsConfig = loadModelsConfig();
    const availableProviders = listProviders(modelsConfig);

    // Parse stage specs from config
    const stage1Spec = parseStageSpec(config.council.responders, availableProviders, modelsConfig);
    const stage2Spec = parseStageSpec(config.council.evaluators, availableProviders, modelsConfig);
    const chairman = createAgentFromSpec(config.council.chairman);

    // Build pipeline config with structured output format
    const pipelineConfig: EnhancedPipelineConfig = {
      stage1: { agents: stage1Spec.agents },
      stage2: { agents: stage2Spec.agents },
      stage3: {
        chairman,
        useReasoning: false,
        outputFormat: CHAIRMAN_OUTPUT_FORMAT,
      },
    };

    // Run the council pipeline
    const result = await runEnhancedPipeline(prompt, {
      config: pipelineConfig,
      timeoutMs: config.council.timeout_seconds * 1000,
      tty: process.stdout.isTTY ?? false,
      silent: false,
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
        onStage2Complete: (rankings, aggregate) => {
          console.log(`\nStage 2 complete: ${rankings.length} rankings`);
          // #region DEBUG_LOGGING - verbose stage 2 logging
          if (DEBUG_LOGGING_ENABLED) {
            rankings.forEach((r, i) => {
              console.log(`  [${i + 1}] ${r.agent}: ranked ${r.parsedRanking?.join(' > ') || 'parse failed'}`);
              debugLog(`Stage 2 ranking ${i + 1} (${r.agent}): ${r.parsedRanking?.join(' > ') || 'PARSE FAILED'}`);
            });
            if (aggregate) {
              console.log(`  Aggregate scores: ${aggregate.map(a => `${a.agent}=${a.averageRank.toFixed(2)}`).join(', ')}`);
            }
          }
          // #endregion DEBUG_LOGGING
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

    // Parse the structured JSON output from chairman
    let structuredOutput: ChairmanStructuredOutput;
    const rawResponse = result.stage3.response;

    try {
      // Try to parse the JSON response directly
      structuredOutput = JSON.parse(rawResponse);
      console.log('\nSuccessfully parsed structured chairman output');
    } catch (parseError) {
      // #region DEBUG_LOGGING - chairman parse error diagnostics
      console.error('\n--- CHAIRMAN PARSE ERROR ---');
      console.error(`Raw response (first 500 chars): ${truncate(rawResponse, 500)}`);
      debugLog(`Chairman parse error. Raw response preview: ${truncate(rawResponse, 1000)}`);

      if (DEBUG_LOGGING_ENABLED) {
        // Save full debug dump
        const dumpPath = saveDebugDump('chairman-raw-response.txt', rawResponse);
        console.error(`Full response saved to: ${dumpPath}`);
        debugLog(`Full chairman response saved to: ${dumpPath}`);

        // Also save the full pipeline result for context
        const pipelineDumpPath = saveDebugDump('pipeline-result.json', {
          stage1: result.stage1.map(s => ({
            agent: s.agent,
            responseLength: s.response?.length || 0,
            responsePreview: truncate(s.response || '', 500),
          })),
          stage2: result.stage2.map(s => ({
            agent: s.agent,
            parsedRanking: s.parsedRanking,
            rankingRawLength: s.rankingRaw?.length || 0,
          })),
          aggregate: result.aggregate,
          stage3: {
            agent: result.stage3.agent,
            responseLength: rawResponse?.length || 0,
          },
        });
        console.error(`Pipeline summary saved to: ${pipelineDumpPath}`);
      }
      // #endregion DEBUG_LOGGING

      // Try to extract JSON from markdown code fences if direct parse fails
      const jsonMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        try {
          structuredOutput = JSON.parse(jsonMatch[1].trim());
          console.log('\nExtracted JSON from markdown code fence');
        } catch (fenceParseError) {
          debugLog(`Failed to parse JSON from code fence: ${fenceParseError}`);
          throw new Error(`Failed to parse chairman output as JSON: ${parseError}`);
        }
      } else {
        // Check if response looks like an error message
        if (rawResponse.startsWith('Error') || rawResponse.includes('Error from')) {
          console.error('\n*** CHAIRMAN RETURNED AN ERROR MESSAGE ***');
          console.error('This usually indicates an API error (rate limit, context too long, or service issue)');
          debugLog(`Chairman returned error message: ${rawResponse}`);
        }
        throw new Error(`Chairman did not return valid JSON: ${parseError}`);
      }
    }

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
      stage1: result.stage1.map(s => ({
        agent: s.agent,
        response: s.response,
      })),
      stage2: {
        rankings: result.stage2.map(s => ({
          agent: s.agent,
          ranking: s.parsedRanking,
        })),
        aggregate: result.aggregate.map(a => ({
          agent: a.agent,
          score: a.averageRank,
        })),
      },
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
      join(ROOT, 'state', 'council-output.json'),
      JSON.stringify(councilOutput, null, 2)
    );

    log(`[${new Date().toISOString()}]
Council complete.
Agents used: ${councilOutput.stage1.map(s => s.agent).join(', ') || 'N/A'}
Ambiguities found: ${councilOutput.ambiguities.length}
Output written to state/council-output.json
`);

    console.log('\n\nCouncil complete. Output written to state/council-output.json');
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
if (preferences || process.env.COUNCIL_RESPONDERS || process.env.COUNCIL_EVALUATORS || process.env.COUNCIL_CHAIRMAN) {
  console.log('Config overrides applied:');
  if (process.env.COUNCIL_RESPONDERS) console.log('  COUNCIL_RESPONDERS (env)');
  if (process.env.COUNCIL_EVALUATORS) console.log('  COUNCIL_EVALUATORS (env)');
  if (process.env.COUNCIL_CHAIRMAN) console.log('  COUNCIL_CHAIRMAN (env)');
  if (process.env.COUNCIL_TIMEOUT) console.log('  COUNCIL_TIMEOUT (env)');
  if (preferences) console.log('  state/council-preferences.json');
  console.log('');
}

runCouncil(prompt, effectiveConfig).catch((err) => {
  console.error('Council failed:', err);
  process.exit(1);
});
