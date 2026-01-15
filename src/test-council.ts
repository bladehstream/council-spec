/**
 * Test Council - Generate comprehensive test plans using agent-council merge mode
 *
 * This uses the merge mode to combine test ideas from multiple AI models,
 * ensuring comprehensive coverage by including all suggested tests rather
 * than picking a "winner".
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  runEnhancedPipeline,
  runTwoPassMergeChairman,
  getPreset,
  buildPipelineConfig,
  listProviders,
  loadModelsConfig,
  createAgentFromSpec,
  parseStageSpec,
  callAgent,
  type EnhancedPipelineConfig,
  type PipelineResult,
  type Stage1Result,
  type AgentConfig,
  type AgentState,
  type TwoPassConfig,
  type Stage2CustomResult,
  type Stage2CustomHandler,
} from 'agent-council';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const STATE_DIR = join(ROOT, 'state');

// ============================================================================
// Sectioned Deduplication for Test Plans
// ============================================================================

/**
 * Section assignments for test deduplication.
 * Each evaluator handles two test categories to parallelize work.
 */
const TEST_DEDUP_SECTION_ASSIGNMENTS = {
  evaluator1: ['unit', 'integration'],
  evaluator2: ['e2e', 'security'],
  evaluator3: ['performance', 'edge_cases'],
} as const;

// ============================================================================
// Spec Feature Extraction for Gap Analysis
// ============================================================================

interface FeatureManifestEntry {
  id: string;
  name: string;
  description: string;
  priority: 'must_have' | 'should_have' | 'nice_to_have';
  acceptance_criteria?: string[];
}

interface SpecFeatures {
  mustHaveFeatures: string[];
  successCriteria: string[];
  securityRequirements: string[];
  performanceRequirements: string[];
  userFlows: string[];
  featureManifest: FeatureManifestEntry[];
}

/**
 * Load spec-final.json and extract features relevant to test coverage.
 */
function loadSpecFeatures(): SpecFeatures | null {
  const specPath = join(STATE_DIR, 'spec-final.json');
  if (!existsSync(specPath)) {
    console.warn('  Warning: spec-final.json not found, gap analysis disabled');
    return null;
  }

  try {
    const spec = JSON.parse(readFileSync(specPath, 'utf-8'));

    // Extract must-have features
    const mustHaveFeatures = (spec.core_functionality || [])
      .filter((f: any) => f.priority === 'must_have')
      .map((f: any) => `${f.feature}: ${f.description}`);

    // Extract success criteria
    const successCriteria = spec.success_criteria || [];

    // Extract security requirements from threat_model
    let securityRequirements: string[] = [];
    if (spec.security) {
      try {
        const secObj = typeof spec.security === 'string'
          ? JSON.parse(spec.security)
          : spec.security;
        if (secObj.threat_model) {
          // Parse threat model - extract specific mitigations
          securityRequirements = [
            `Authentication: ${secObj.authentication || 'N/A'}`,
            `Authorization: ${secObj.authorization || 'N/A'}`,
            `Data Protection: ${secObj.data_protection || 'N/A'}`,
            `Threat Mitigations: ${secObj.threat_model || 'N/A'}`,
          ];
        }
      } catch {
        securityRequirements = [String(spec.security).substring(0, 500)];
      }
    }

    // Extract performance requirements from success criteria
    const performanceRequirements = successCriteria.filter((c: string) =>
      /second|ms|latency|load|performance|speed/i.test(c)
    );

    // Extract user flows (may be array or JSON string)
    let userFlowsArray: any[] = [];
    if (spec.user_flows) {
      if (Array.isArray(spec.user_flows)) {
        userFlowsArray = spec.user_flows;
      } else if (typeof spec.user_flows === 'string') {
        try {
          userFlowsArray = JSON.parse(spec.user_flows);
        } catch {
          // If it's not valid JSON, treat as single string
          userFlowsArray = [spec.user_flows];
        }
      }
    }
    const userFlows = userFlowsArray.map((f: any) =>
      typeof f === 'string' ? f : `${f.name || f.flow}: ${f.description || f.steps?.join(' → ') || ''}`
    );

    // Extract feature manifest (for traceability)
    const featureManifest: FeatureManifestEntry[] = spec.feature_manifest?.features || [];
    if (featureManifest.length > 0) {
      console.log(`  Loaded feature manifest: ${featureManifest.length} features with IDs`);
    } else {
      console.warn('  Warning: No feature manifest found - test traceability will be limited');
    }

    return {
      mustHaveFeatures,
      successCriteria,
      securityRequirements,
      performanceRequirements,
      userFlows,
      featureManifest,
    };
  } catch (err) {
    console.warn('  Warning: Failed to parse spec-final.json:', err);
    return null;
  }
}

/**
 * Map evaluator sections to relevant spec features.
 */
function getSpecFeaturesForSections(
  sections: readonly string[],
  specFeatures: SpecFeatures
): string {
  const features: string[] = [];

  if (sections.includes('unit') || sections.includes('integration')) {
    features.push('## Must-Have Features (require test coverage)');
    specFeatures.mustHaveFeatures.forEach(f => features.push(`- ${f}`));
  }

  if (sections.includes('e2e')) {
    features.push('## User Flows (require E2E test coverage)');
    specFeatures.userFlows.forEach(f => features.push(`- ${f}`));
  }

  if (sections.includes('security')) {
    features.push('## Security Requirements (CRITICAL - require test coverage)');
    specFeatures.securityRequirements.forEach(f => features.push(`- ${f}`));
    features.push('');
    features.push('IMPORTANT: The following security tests are REQUIRED:');
    features.push('- SSRF prevention (URL validation)');
    features.push('- XSS prevention (output encoding)');
    features.push('- SQL/NoSQL injection prevention');
    features.push('- LLM prompt injection mitigation');
    features.push('- Rate limiting');
    features.push('- Input validation');
    features.push('- Credential encryption verification');
  }

  if (sections.includes('performance')) {
    features.push('## Performance Requirements (require test coverage)');
    specFeatures.performanceRequirements.forEach(f => features.push(`- ${f}`));
  }

  if (sections.includes('edge_cases')) {
    features.push('## Edge Cases to Test');
    features.push('- Network timeouts and failures');
    features.push('- Empty/null data handling');
    features.push('- Concurrent operations');
    features.push('- Unicode and special characters');
    features.push('- Boundary conditions');
    features.push('- LLM hallucination handling');
  }

  return features.join('\n');
}

/**
 * Build the deduplication prompt for a test evaluator.
 */
function buildTestDedupPrompt(
  sections: readonly string[],
  stage1Responses: Stage1Result[],
  specFeatures: SpecFeatures | null
): string {
  const responsesText = stage1Responses
    .map((r, i) => `===RESPONSE FROM: ${r.agent}===\nMODEL: ${r.agent}\nRESPONSE_INDEX: ${i}\n\n${r.response}\n===END RESPONSE FROM: ${r.agent}===`)
    .join('\n\n');

  // Get spec features relevant to this evaluator's sections
  const specFeaturesText = specFeatures
    ? getSpecFeaturesForSections(sections, specFeatures)
    : '';

  return `You are a ${sections.join(' and ')} testing expert. You are receiving tests from multiple AI models.

## Your Role

1. DEDUPLICATE: Only merge tests that are clearly identical (same scenario, methodology, and expected outcome)
2. PRESERVE DISTINCT SCENARIOS: Tests for different attack vectors, edge cases, or features are NOT duplicates
3. VERIFY COVERAGE: After deduplication, check if all required features have test coverage
4. FLAG GAPS: Report any missing coverage in the GAP_FLAGS section

${specFeaturesText ? `## Specification Requirements (MUST have test coverage)\n\n${specFeaturesText}\n` : ''}
## Input Responses

${responsesText}

## Output Format

IMPORTANT: Preserve ALL distinct test scenarios. Only merge truly identical tests.
IMPORTANT: When merging tests, UNION the validates_features arrays from all source tests.

For each section, list tests with full details:

===SECTION:${sections[0]}===
[MODEL: source_model(s)]
ID: TEST-XXX
Name: Test name
Description: What this tests
Priority: critical/high/medium/low
Validates Features: FEAT-001, FEAT-002 (feature IDs this test validates)
Steps:
1. Step one
2. Step two
Expected Result: What should happen
Coverage: What features/requirements this covers

[Next test...]

${sections.length > 1 ? `===SECTION:${sections[1]}===
[Same format as above]\n` : ''}
===GAP_FLAGS===
List any specification requirements that do NOT have adequate test coverage:
- GAP: [requirement] - [what test is missing]
- GAP: [FEAT-XXX] [feature name] - [what test is missing]
(Write "NONE" if all requirements have coverage)`;
}

/**
 * Run a single deduplication evaluator for assigned test sections.
 */
async function runTestDedupEvaluator(
  evaluatorAgent: AgentConfig,
  sections: readonly string[],
  stage1Responses: Stage1Result[],
  timeoutMs: number,
  specFeatures: SpecFeatures | null
): Promise<{ agent: string; sections: string[]; response: string; gapFlags: string[] }> {
  const prompt = buildTestDedupPrompt(sections, stage1Responses, specFeatures);

  // Create initial AgentState with the agent config
  const state: AgentState = {
    config: evaluatorAgent,
    status: 'pending',
    stdout: [],
    stderr: [],
  };

  const result = await callAgent(state, prompt, timeoutMs);

  // Extract response from stdout
  const response = result.stdout.join('\n');

  // Extract gap flags from response
  const gapFlags: string[] = [];
  const gapMatch = response.match(/===GAP_FLAGS===\s*([\s\S]*?)(?====|$)/);
  if (gapMatch) {
    const gapSection = gapMatch[1].trim();
    if (!gapSection.toLowerCase().includes('none')) {
      const gapLines = gapSection.split('\n').filter(line => line.trim().startsWith('- GAP:') || line.trim().startsWith('GAP:'));
      gapFlags.push(...gapLines.map(line => line.replace(/^-?\s*GAP:\s*/i, '').trim()));
    }
  }

  return {
    agent: evaluatorAgent.name,
    sections: [...sections],
    response,
    gapFlags,
  };
}

/**
 * Parse dedup evaluator response into structured format.
 */
function parseTestDedupResponse(response: string): {
  sections: Record<string, string>;
  conflicts: Array<{ topic: string; positions: Array<{ agent: string; position: string }> }>;
  uniqueInsights: Array<{ source: string; insight: string }>;
} {
  const sections: Record<string, string> = {};
  const conflicts: Array<{ topic: string; positions: Array<{ agent: string; position: string }> }> = [];
  const uniqueInsights: Array<{ source: string; insight: string }> = [];

  // Extract sections
  const sectionPattern = /===SECTION:(\w+)===\s*([\s\S]*?)(?====(?:SECTION|CONFLICTS|UNIQUE_INSIGHTS):|$)/g;
  let match;
  while ((match = sectionPattern.exec(response)) !== null) {
    sections[match[1]] = match[2].trim();
  }

  // Extract conflicts
  const conflictPattern = /===CONFLICTS:(\w+)===\s*([\s\S]*?)(?====(?:SECTION|CONFLICTS|UNIQUE_INSIGHTS):|$)/g;
  while ((match = conflictPattern.exec(response)) !== null) {
    const conflictText = match[2].trim();
    const topicPattern = /- Topic: ([^\n]+)\n((?:\s+- \[MODEL: [^\]]+\] [^\n]+\n?)+)/g;
    let topicMatch;
    while ((topicMatch = topicPattern.exec(conflictText)) !== null) {
      const topic = topicMatch[1];
      const positionsText = topicMatch[2];
      const positions: Array<{ agent: string; position: string }> = [];
      const posPattern = /\[MODEL: ([^\]]+)\] ([^\n]+)/g;
      let posMatch;
      while ((posMatch = posPattern.exec(positionsText)) !== null) {
        positions.push({ agent: posMatch[1], position: posMatch[2] });
      }
      if (positions.length > 0) {
        conflicts.push({ topic, positions });
      }
    }
  }

  // Extract unique insights
  const insightPattern = /===UNIQUE_INSIGHTS:(\w+)===\s*([\s\S]*?)(?====(?:SECTION|CONFLICTS|UNIQUE_INSIGHTS):|$)/g;
  while ((match = insightPattern.exec(response)) !== null) {
    const insightText = match[2].trim();
    const itemPattern = /- \[MODEL: ([^\]]+)\] ([^\n]+)/g;
    let itemMatch;
    while ((itemMatch = itemPattern.exec(insightText)) !== null) {
      uniqueInsights.push({ source: itemMatch[1], insight: itemMatch[2] });
    }
  }

  return { sections, conflicts, uniqueInsights };
}

/**
 * Create a sectioned deduplication handler for test plans.
 */
function createTestSectionedDedupHandler(
  evaluatorSpec: string,
  availableProviders: string[],
  modelsConfig: ReturnType<typeof loadModelsConfig>,
  timeoutMs: number
): Stage2CustomHandler {
  // Note: _agents and _timeout are passed by pipeline but we use closure-captured values
  return async (stage1Results: Stage1Result[], _agents?: AgentConfig[], _timeout?: number): Promise<Stage2CustomResult> => {
    console.log('');
    console.log('  [Stage 2] Sectioned Test Deduplication with Gap Analysis');

    // Load spec features for gap analysis
    const specFeatures = loadSpecFeatures();
    if (specFeatures) {
      console.log('    Loaded spec features for coverage verification');
    }

    // Parse evaluator spec (e.g., "3:default")
    const evalSpec = parseStageSpec(evaluatorSpec, availableProviders, modelsConfig);
    const agents = evalSpec.agents.slice(0, 3); // Max 3 evaluators

    if (agents.length < 3) {
      console.log(`    Warning: Need 3 evaluators, got ${agents.length}. Padding with defaults.`);
      while (agents.length < 3) {
        agents.push(createAgentFromSpec('claude:default'));
      }
    }

    const assignments = Object.entries(TEST_DEDUP_SECTION_ASSIGNMENTS);

    // Run all 3 evaluators in parallel
    console.log(`    Running ${agents.length} evaluators in parallel...`);
    const evalPromises = assignments.map(([_key, sections], i) =>
      runTestDedupEvaluator(agents[i], sections, stage1Results, timeoutMs, specFeatures)
    );

    const evalResults = await Promise.all(evalPromises);

    // Merge results
    const mergedSections: Record<string, string> = {};
    const allConflicts: Array<{ topic: string; positions: Array<{ agent: string; position: string }> }> = [];
    const allUniqueInsights: Array<{ source: string; insight: string }> = [];
    const allGapFlags: string[] = [];

    for (const result of evalResults) {
      console.log(`    ${result.agent}: processed ${result.sections.join(', ')}`);
      if (result.gapFlags.length > 0) {
        console.log(`      ⚠️  Coverage gaps: ${result.gapFlags.length}`);
        result.gapFlags.forEach(gap => console.log(`         - ${gap}`));
      }
      const parsed = parseTestDedupResponse(result.response);

      Object.assign(mergedSections, parsed.sections);
      allConflicts.push(...parsed.conflicts);
      allUniqueInsights.push(...parsed.uniqueInsights);
      allGapFlags.push(...result.gapFlags);
    }

    // Calculate compression
    const originalSize = stage1Results.reduce((sum, r) => sum + r.response.length, 0);
    const dedupedSize = Object.values(mergedSections).reduce((sum, s) => sum + s.length, 0);
    const compressionPct = ((1 - dedupedSize / originalSize) * 100).toFixed(1);

    console.log(`    Deduplication complete: ${originalSize} → ${dedupedSize} chars (${compressionPct}% reduction)`);
    console.log(`    Conflicts found: ${allConflicts.length}`);
    console.log(`    Unique insights: ${allUniqueInsights.length}`);
    if (allGapFlags.length > 0) {
      console.log(`    ⚠️  Total coverage gaps: ${allGapFlags.length}`);
    } else {
      console.log(`    ✓ No coverage gaps detected`);
    }

    // Store gap flags in uniqueInsights for now (to pass to chairman)
    // We prefix with [COVERAGE_GAP] so chairman can identify them
    allGapFlags.forEach(gap => {
      allUniqueInsights.push({ source: 'gap_analysis', insight: `[COVERAGE_GAP] ${gap}` });
    });

    return {
      sections: mergedSections,
      conflicts: allConflicts,
      uniqueInsights: allUniqueInsights,
    };
  };
}

/**
 * Check if test deduplication is enabled (default: true).
 */
function isTestDedupEnabled(): boolean {
  return process.env.TEST_COUNCIL_SKIP_DEDUP !== 'true' && process.env.COUNCIL_SKIP_DEDUP !== 'true';
}

/**
 * Get evaluator spec for test deduplication.
 */
function getTestDedupEvaluatorSpec(): string {
  return process.env.TEST_COUNCIL_DEDUP_EVALUATORS || process.env.COUNCIL_DEDUP_EVALUATORS || '3:default';
}

/**
 * Convert dedup result to consolidated markdown for chairman input.
 */
function buildConsolidatedMarkdown(dedupResult: Stage2CustomResult): string {
  const parts: string[] = [];

  // Add deduplicated sections
  parts.push('# Deduplicated Test Plan Sections\n');
  for (const [section, content] of Object.entries(dedupResult.sections)) {
    parts.push(`## ${section.toUpperCase()}\n`);
    parts.push(content);
    parts.push('\n');
  }

  // Add conflicts if any
  if (dedupResult.conflicts && dedupResult.conflicts.length > 0) {
    parts.push('\n# Conflicts Requiring Resolution\n');
    for (const conflict of dedupResult.conflicts) {
      parts.push(`## ${conflict.topic}\n`);
      for (const pos of conflict.positions) {
        parts.push(`- [${pos.agent}]: ${pos.position}\n`);
      }
    }
  }

  // Add unique insights
  if (dedupResult.uniqueInsights && dedupResult.uniqueInsights.length > 0) {
    parts.push('\n# Unique Insights (preserve these)\n');
    for (const insight of dedupResult.uniqueInsights) {
      parts.push(`- [${insight.source}]: ${insight.insight}\n`);
    }
  }

  return parts.join('');
}

// Extended spec type that matches actual spec-final.json structure
interface ExtendedSpec {
  metadata?: {
    project_name?: string;
    version?: string;
  };
  problem_statement?: {
    summary: string;
    context?: string;
    motivation?: string;
  };
  core_functionality?: Array<{
    feature: string;
    description?: string;
    priority: string;
  }>;
  success_criteria?: string[];
  // Fields can be at root level (extended format) or nested (SpecFinal format)
  architecture?: string;
  data_model?: string;
  api_contracts?: string;
  user_flows?: string;
  security?: string;
  deployment?: string;
  // Or nested under specification (SpecFinal format)
  specification?: {
    overview: string;
    architecture: string;
    data_model: string;
    api_contracts: string;
    user_flows: string;
    security: string;
    deployment: string;
    acceptance_criteria: string[];
  };
  // Legacy fields
  project_id?: string;
  interview_summary?: string;
}

// ============================================================================
// Test Plan Types
// ============================================================================

interface TestSource {
  model: string;              // Primary contributor (e.g., "claude:default")
  merged_from?: string[];     // If deduplicated from multiple models
  similarity_note?: string;   // Optional note if merged similar tests
  created_by_chairman?: boolean; // True if test was added during gap analysis
}

interface TestCase {
  id: string;
  name: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  preconditions?: string[];
  steps?: string[];
  expected_result: string;
  coverage?: string[];
  validates_features?: string[];                    // Feature IDs this test validates ["FEAT-001"]
  source?: TestSource;                              // Model attribution
  atomicity?: 'atomic' | 'split_recommended';       // Atomicity status
  split_suggestion?: string[];                      // Suggested split test names
  split_from?: string;                              // Original test ID if split
  quantifiable?: boolean;                           // False if acceptance criteria unclear
  clarification_needed?: string;                    // What's missing from spec
  suggested_threshold?: string;                     // AI-suggested quantifiable criteria
  spec_section?: string;                            // Where in spec this should be defined
}

interface TestPlanOutput {
  metadata: {
    project_id: string;
    spec_version: string;
    generated_at: string;
    total_tests: number;
    preset_used: string;
  };
  tests: {
    unit: TestCase[];
    integration: TestCase[];
    e2e: TestCase[];
    security: TestCase[];
    performance: TestCase[];
    edge_cases: TestCase[];
  };
  coverage_summary: {
    features_covered: string[];
    features_uncovered?: string[];      // Feature IDs with NO tests (gaps)
    gaps_identified: string[];
    coverage_percentage?: number;       // Percentage of features with tests
    quantifiability?: {
      total_tests: number;
      quantifiable: number;
      needs_clarification: number;
      clarification_report?: string;
    };
  };
  merge_metadata?: {
    models_used: string[];
    unique_contributions: Array<{
      source: string;
      count: number;
    }>;
    attribution_summary?: {
      unique_tests: number;      // Tests from single model
      merged_tests: number;      // Tests merged from multiple models
      by_model: Record<string, number>;  // Count per model
    };
  };
  split_metadata?: {
    original_count: number;
    split_count: number;
    tests_split: Array<{
      original_id: string;
      split_into: string[];
    }>;
  };
}

// ============================================================================
// Test Council Options & Result (for programmatic use)
// ============================================================================

export interface TestCouncilOptions {
  /** Preset name (defaults to 'merge-balanced') */
  preset?: string;
  /** Override responders (e.g., '3:heavy' or 'claude:heavy,gemini:heavy') */
  responders?: string;
  /** Override chairman (e.g., 'gemini:heavy' or 'claude:heavy/default') */
  chairman?: string;
  /** Whether this is running from phase.ts (affects output path handling) */
  fromPhase?: boolean;
  /** TTY mode for interactive prompts */
  tty?: boolean;
}

export interface TestCouncilResult {
  success: boolean;
  outputPath?: string;
  testPlan?: TestPlanOutput;
  totalTests?: number;
  error?: string;
  durationMs: number;
}

// ============================================================================
// Logging
// ============================================================================

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

// ============================================================================
// Test Plan Prompt
// ============================================================================

function buildTestPlanPrompt(spec: ExtendedSpec): string {
  // Handle both nested (SpecFinal) and flat (ExtendedSpec) formats
  const overview = spec.specification?.overview
    || spec.problem_statement?.summary
    || spec.interview_summary
    || 'No overview available';

  const architecture = spec.specification?.architecture || spec.architecture || 'Not specified';
  const dataModel = spec.specification?.data_model || spec.data_model || 'Not specified';
  const apiContracts = spec.specification?.api_contracts || spec.api_contracts || 'Not specified';
  const userFlows = spec.specification?.user_flows || spec.user_flows || 'Not specified';
  const security = spec.specification?.security || spec.security || 'Not specified';

  const acceptanceCriteria = spec.specification?.acceptance_criteria || spec.success_criteria || [];
  const criteriaText = acceptanceCriteria.length > 0
    ? acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
    : 'Not specified';

  // Include core functionality if available
  const coreFunctionality = spec.core_functionality?.length
    ? spec.core_functionality.map(f => `- ${f.feature}: ${f.description || 'No description'} (${f.priority})`).join('\n')
    : '';

  // Extract feature manifest for traceability
  const featureManifest = (spec as any).feature_manifest?.features || [];
  const featureManifestText = featureManifest.length > 0
    ? featureManifest.map((f: FeatureManifestEntry) => `- ${f.id}: ${f.name} [${f.priority}] - ${f.description}`).join('\n')
    : '';

  // Build feature traceability section
  const traceabilitySection = featureManifestText
    ? `
## CRITICAL: Feature Traceability

Every test MUST include a \`validates_features\` array with at least one feature ID.
Link tests to features NOW — this is when you know exactly why you're creating each test.

**Feature Manifest:**
${featureManifestText}

When creating tests, reference the feature IDs above. For example:
- A test for password validation should include \`"validates_features": ["FEAT-001"]\`
- A test covering multiple features should include all relevant IDs

`
    : '';

  return `You are a senior QA engineer tasked with creating a comprehensive test plan.

## Project Specification

**Overview:**
${overview}

${coreFunctionality ? `**Core Functionality:**\n${coreFunctionality}\n` : ''}
**Architecture:**
${architecture}

**Data Model:**
${dataModel}

**API Contracts:**
${apiContracts}

**User Flows:**
${userFlows}

**Security:**
${security}

**Acceptance Criteria:**
${criteriaText}
${traceabilitySection}
## Your Task

Generate a comprehensive test plan covering ALL aspects of this specification.
Include tests that YOU uniquely think of - don't just cover the obvious cases.

For EACH test, provide:
1. A unique ID (format: TYPE-NNN, e.g., UNIT-001, INT-001, E2E-001, SEC-001, PERF-001, EDGE-001)
2. A descriptive name
3. Clear description of what's being tested
4. Priority (critical/high/medium/low)
5. Category (the feature or component being tested)
6. Expected result
7. **validates_features** - Array of feature IDs this test validates (e.g., ["FEAT-001", "FEAT-002"])
8. Which parts of the spec it covers

## Output Format

Output your test plan as JSON with this structure:
\`\`\`json
{
  "tests": {
    "unit": [
      {
        "id": "UNIT-001",
        "name": "Test name",
        "description": "What this tests",
        "priority": "high",
        "category": "authentication",
        "validates_features": ["FEAT-001"],
        "preconditions": ["User exists in database"],
        "steps": ["Step 1", "Step 2"],
        "expected_result": "Expected outcome",
        "coverage": ["API: POST /auth/login", "Security: Password hashing"]
      }
    ],
    "integration": [...],
    "e2e": [...],
    "security": [...],
    "performance": [...],
    "edge_cases": [...]
  },
  "coverage_summary": {
    "features_covered": ["FEAT-001", "FEAT-002"],
    "gaps_identified": ["Any areas not fully tested"]
  }
}
\`\`\`

Be thorough. Include edge cases. Think about what could go wrong.
IMPORTANT: Every test MUST include validates_features with at least one feature ID from the Feature Manifest.
`;
}

// ============================================================================
// Main
// ============================================================================

/**
 * Run the test council programmatically.
 * This is the main entry point that can be called from phase.ts or directly.
 */
export async function runTestCouncil(options: TestCouncilOptions = {}): Promise<TestCouncilResult> {
  const startTime = Date.now();

  console.log('='.repeat(60));
  console.log('TEST COUNCIL - Generate Test Plan via Merge Mode');
  console.log('='.repeat(60));
  console.log('');

  // Check for spec-final.json
  const specPath = join(STATE_DIR, 'spec-final.json');
  if (!existsSync(specPath)) {
    const errorMsg = 'Error: state/spec-final.json not found. Run "npm run finalize" first.';
    console.error(errorMsg);
    return {
      success: false,
      error: errorMsg,
      durationMs: Date.now() - startTime,
    };
  }

  const spec: ExtendedSpec = JSON.parse(readFileSync(specPath, 'utf-8'));
  const projectName = spec.metadata?.project_name || spec.project_id || 'Unknown Project';
  const version = spec.metadata?.version || '1.0.0';
  console.log(`Loaded spec: ${projectName} v${version}`);

  // Determine preset (options > TEST_COUNCIL_PRESET > COUNCIL_PRESET > default)
  const presetName = options.preset || process.env.TEST_COUNCIL_PRESET || process.env.COUNCIL_PRESET || 'merge-balanced';
  console.log(`Using preset: ${presetName}`);

  // Load config and get available providers
  const config = loadModelsConfig();
  const availableProviders = listProviders(config).filter(p => {
    // Simple check - in production you'd verify the CLI exists
    return true;
  });

  if (availableProviders.length === 0) {
    const errorMsg = 'Error: No providers available';
    console.error(errorMsg);
    return {
      success: false,
      error: errorMsg,
      durationMs: Date.now() - startTime,
    };
  }

  console.log(`Available providers: ${availableProviders.join(', ')}`);

  // Get preset and build pipeline config
  const preset = getPreset(presetName, config);
  const pipelineConfig = buildPipelineConfig(preset, availableProviders, config);

  // Apply overrides (options take precedence over env vars)
  const chairmanOverride = options.chairman || process.env.COUNCIL_CHAIRMAN;
  if (chairmanOverride) {
    const chairmanSpec = chairmanOverride;
    console.log(`Overriding chairman with: ${chairmanSpec}`);

    // Parse format: provider:tier or provider:pass1tier/pass2tier
    // Examples: claude:heavy, gemini:heavy/default, claude:default/fast
    const [provider, tierPart] = chairmanSpec.split(':');
    let pass1Tier: 'fast' | 'default' | 'heavy' = 'default';
    let pass2Tier: 'fast' | 'default' | 'heavy' = 'default';

    if (tierPart) {
      if (tierPart.includes('/')) {
        // Granular format: pass1tier/pass2tier
        const [p1, p2] = tierPart.split('/');
        pass1Tier = (p1 || 'default') as 'fast' | 'default' | 'heavy';
        pass2Tier = (p2 || 'default') as 'fast' | 'default' | 'heavy';
        console.log(`  Pass 1: ${provider}:${pass1Tier}, Pass 2: ${provider}:${pass2Tier}`);
      } else {
        // Single tier for both passes
        pass1Tier = tierPart as 'fast' | 'default' | 'heavy';
        pass2Tier = tierPart as 'fast' | 'default' | 'heavy';
      }
    }

    // Create chairman agent using pass1 tier (primary tier for chairman identity)
    const chairmanAgent = createAgentFromSpec(`${provider}:${pass1Tier}`);
    pipelineConfig.stage3.chairman = chairmanAgent;

    if (pipelineConfig.stage3.twoPass) {
      pipelineConfig.stage3.twoPass.pass1Tier = pass1Tier;
      pipelineConfig.stage3.twoPass.pass2Tier = pass2Tier;
    }
  }

  const respondersOverride = options.responders || process.env.COUNCIL_RESPONDERS;
  if (respondersOverride) {
    const respondersSpec = respondersOverride;
    console.log(`Overriding responders with: ${respondersSpec}`);
    // Parse responders spec (e.g., "3:heavy" or "claude:heavy,gemini:heavy,codex:heavy")
    const responderAgents = respondersSpec.includes(':') && !respondersSpec.includes(',')
      ? // Count:tier format like "3:heavy"
        (() => {
          const [countStr, tier] = respondersSpec.split(':');
          const count = parseInt(countStr, 10);
          return availableProviders.slice(0, count).map(p => createAgentFromSpec(`${p}:${tier}`));
        })()
      : // Explicit list like "claude:heavy,gemini:heavy"
        respondersSpec.split(',').map(spec => createAgentFromSpec(spec.trim()));
    pipelineConfig.stage1.agents = responderAgents;
  }

  // Override stage1 prompt with our test plan prompt
  const testPrompt = buildTestPlanPrompt(spec);
  pipelineConfig.stage1.prompt = testPrompt;

  // Set output format for chairman with source attribution and atomicity analysis
  const modelsUsed = pipelineConfig.stage1.agents.map(a => a.name).join(', ');

  // Configure two-pass prompts for test plan generation
  // Pass 1: Merge and categorize tests from all responders
  // Pass 2: Produce final structured JSON with attribution
  if (pipelineConfig.stage3.twoPass) {
    // Use custom prompt mode - this replaces the default merge prompt entirely
    // Placeholders ${RESPONSES} and ${MODEL_LIST} will be substituted by agent-council
    pipelineConfig.stage3.twoPass.pass1IsCustomPrompt = true;
    pipelineConfig.stage3.twoPass.pass1Format = `You are receiving deduplicated tests from multiple AI models: \${MODEL_LIST}

## CRITICAL INSTRUCTIONS

1. PRESERVE DISTINCT SCENARIOS: Different attack vectors, edge cases, or test approaches are NOT duplicates
2. MINIMUM TEST COUNTS:
   - Security: at least 6 tests (SSRF, XSS, injection, auth, rate limiting, input validation)
   - E2E: at least 4 tests (main user flows)
   - Unit: at least 8 tests (core functions)
   - Integration: at least 4 tests
   - Performance: at least 3 tests
   - Edge cases: at least 4 tests
3. COVERAGE GAP HANDLING: Look for [COVERAGE_GAP] markers - these indicate missing test coverage that MUST be addressed
4. ONLY MERGE TRULY IDENTICAL TESTS: Same scenario, same methodology, same expected outcome
5. FEATURE TRACEABILITY - UNION MERGE: When merging tests, COMBINE their validates_features arrays:
   - Test A validates [FEAT-001] + Test B validates [FEAT-002] → Merged test validates [FEAT-001, FEAT-002]
   - Every test in your output MUST have at least one feature ID in its validates_features
   - Preserve ALL feature references from source tests - never drop feature linkages

## Responses to Process

\${RESPONSES}

## Instructions

For each test, note which model(s) contributed it AND its feature linkages:
[MODEL: model_name] [FEATURES: FEAT-001, FEAT-002] Test Name - Description

Group tests by category. IMPORTANT: If a category has fewer tests than the minimum, CREATE additional tests to fill gaps.
When creating new tests, assign appropriate feature IDs based on what the test validates.

## UNIT TESTS (minimum 8)
[MODEL: claude:heavy] [FEATURES: FEAT-001] Test Name - Brief description
[MODEL: gemini:heavy, claude:heavy] [FEATURES: FEAT-001, FEAT-003] Test Name - (merged features from both models)
...

## INTEGRATION TESTS (minimum 4)
...

## E2E TESTS (minimum 4)
...

## SECURITY TESTS (minimum 6 - CRITICAL)
Must include: SSRF prevention, XSS prevention, SQL/NoSQL injection, LLM prompt injection, Rate limiting, Input validation
...

## PERFORMANCE TESTS (minimum 3)
...

## EDGE CASE TESTS (minimum 4)
...

## COVERAGE GAPS ADDRESSED
- [COVERAGE_GAP] flags found and addressed: (list)
- Additional tests created to meet minimums: (list)

## FEATURE TRACEABILITY SUMMARY
- Tests with feature linkages: (count)
- Union merges performed: (count)

## STATISTICS
- Total tests listed: (count)
- Tests merged: (count)
- Tests created for gaps: (count)`;

    pipelineConfig.stage3.twoPass.pass2Format = `Convert the merged test list from Pass 1 into structured JSON.

CRITICAL: Output ONLY valid JSON, no markdown code fences, no additional text.

The models used were: ${modelsUsed}

For source attribution:
- Extract model name from [MODEL: xxx] tags
- If multiple models listed, use first as source.model, rest as source.merged_from
- For tests you create to fill gaps, use source.model = "chairman" and source.created_by_chairman = true

For feature traceability:
- Extract feature IDs from [FEATURES: FEAT-001, FEAT-002] tags
- validates_features MUST be an array of feature IDs (e.g., ["FEAT-001", "FEAT-002"])
- Every test MUST have at least one feature ID in validates_features
- When tests were merged, include ALL feature IDs from ALL source tests (union merge)

JSON structure:
{
  "tests": {
    "unit": [{"id": "UNIT-001", "name": "...", "description": "...", "priority": "high|medium|low", "category": "...", "steps": ["..."], "expected_result": "...", "validates_features": ["FEAT-001"], "source": {"model": "...", "merged_from": ["..."]}}],
    "integration": [...],
    "e2e": [...],
    "security": [...],
    "performance": [...],
    "edge_cases": [...]
  },
  "coverage_summary": {
    "features_covered": ["FEAT-001", "FEAT-002"],
    "features_uncovered": ["FEAT-003"],
    "gaps_identified": ["..."],
    "coverage_percentage": 66
  },
  "merge_notes": "..."
}`;
  }

  pipelineConfig.stage3.outputFormat = `You are receiving a large number of tests from multiple AI models.

Only merge tests that are clearly identical - same scenario, same test methodology, same expected outcome.

## RESPONSE FORMAT

Each responder's output is tagged with this format:
===RESPONSE FROM: <model_name>===
MODEL: <model_name>
RESPONSE_INDEX: N

<response content>

===END RESPONSE FROM: <model_name>===

Use the MODEL field to identify which model contributed each test.
The models providing tests are: ${modelsUsed}

## SOURCE ATTRIBUTION

For EACH test, include a "source" object tracking which model(s) contributed it:
- If a test came from ONE model only: source.model = "<model_name>" (use the MODEL field value)
- If similar tests existed in multiple models and you kept one version:
  - source.model = "<model whose version you kept>"
  - source.merged_from = ["<other models with similar test>"]
- If you combined content from multiple tests: add source.similarity_note explaining the merge
- If YOU (the chairman) create a NEW test during gap analysis that was NOT in any responder's output:
  - source.model = "chairman"
  - source.created_by_chairman = true
  - Do NOT attribute chairman-created tests to responder models

## ATOMICITY ANALYSIS

For EACH test, evaluate if it should be split into smaller atomic tests.

SPLIT INDICATORS (set atomicity: "split_recommended"):
- More than 6 steps
- Steps test fundamentally different code paths (e.g., generation vs validation)
- Multiple distinct expected outcomes implied
- "and" in the test name suggesting multiple concerns
- Steps that could fail independently

DO NOT SPLIT (set atomicity: "atomic" or omit the field):
- Sequential steps that form one logical flow
- Setup steps followed by a single verification
- Tests where steps are interdependent

For tests that should be split:
1. Add field: "atomicity": "split_recommended"
2. Add field: "split_suggestion": ["<suggested test 1 name>", "<suggested test 2 name>", ...]

## QUANTIFIABILITY ANALYSIS

For EACH test, evaluate if the expected_result is objectively verifiable.

QUANTIFIABLE (good - omit the quantifiable field or set to true):
- "Returns 200 status code"
- "Latency < 500ms"
- "Exactly 6 numeric digits"
- "File size < 5MB"
- "Completes within 30 seconds"

NOT QUANTIFIABLE (flag with quantifiable: false):
- "Works correctly"
- "Gracefully degrades"
- "Performs well"
- "At threshold" (threshold undefined in spec)
- "Reasonable time"
- "Appropriate response"

For tests with unquantifiable acceptance criteria:
1. Add field: "quantifiable": false
2. Add field: "clarification_needed": "<what specific threshold or criteria is missing>"
3. Add field: "suggested_threshold": "<if you can infer a reasonable threshold from context>"
4. Add field: "spec_section": "<which part of the spec should define this threshold>"

## FEATURE TRACEABILITY

For EACH test, include validates_features linking to feature IDs from the spec:
- validates_features MUST be an array of feature IDs (e.g., ["FEAT-001", "FEAT-002"])
- Every test MUST have at least one feature ID
- When merging similar tests: UNION the validates_features arrays from all source tests
- Example: Test A validates [FEAT-001], Test B validates [FEAT-002] → Merged test validates [FEAT-001, FEAT-002]

JSON structure:
{
  "tests": {
    "unit": [
      {
        "id": "UNIT-001",
        "name": "Test name",
        "description": "...",
        "priority": "high",
        "category": "...",
        "steps": ["step1", "step2"],
        "expected_result": "...",
        "validates_features": ["FEAT-001", "FEAT-002"],
        "source": {
          "model": "claude:default",
          "merged_from": ["gemini:default"],
          "similarity_note": "Combined assertions from both models"
        },
        "atomicity": "atomic"
      },
      {
        "id": "UNIT-002",
        "name": "Token Generation and Validation",
        "description": "...",
        "priority": "high",
        "category": "...",
        "steps": ["generate token", "validate format", "test expiry", "test invalid tokens", ...],
        "expected_result": "...",
        "validates_features": ["FEAT-003"],
        "source": { "model": "gemini:default" },
        "atomicity": "split_recommended",
        "split_suggestion": ["Token Generation", "Token Format Validation", "Token Expiry", "Invalid Token Handling"]
      },
      {
        "id": "PERF-007",
        "name": "Thermal Throttling Behavior",
        "description": "...",
        "priority": "high",
        "category": "performance",
        "expected_result": "System gracefully degrades under thermal pressure",
        "validates_features": ["FEAT-005"],
        "source": { "model": "codex:default" },
        "quantifiable": false,
        "clarification_needed": "What CPU temperature triggers throttling? What does 'gracefully' mean?",
        "suggested_threshold": "Throttle at CPU > 85°C; graceful = no crashes, <1s transition",
        "spec_section": "Architecture > Thermal Management"
      },
      {
        "id": "SEC-010",
        "name": "SQL Injection Prevention",
        "description": "Test added by chairman during gap analysis - not in any responder output",
        "priority": "critical",
        "category": "security",
        "expected_result": "All user inputs are properly sanitized",
        "validates_features": ["FEAT-001"],
        "source": { "model": "chairman", "created_by_chairman": true }
      }
    ],
    "integration": [...],
    "e2e": [...],
    "security": [...],
    "performance": [...],
    "edge_cases": [...]
  },
  "coverage_summary": {
    "features_covered": ["FEAT-001", "FEAT-002"],
    "features_uncovered": ["FEAT-003"],
    "gaps_identified": [...],
    "coverage_percentage": 66
  },
  "merge_notes": "Brief notes on how responses were merged"
}`;

  log(`
--- PHASE: TEST COUNCIL ---
[${new Date().toISOString()}]

Preset: ${presetName}
Mode: ${pipelineConfig.mode}
Responders: ${pipelineConfig.stage1.agents.map(a => a.name).join(', ')}
Chairman: ${pipelineConfig.stage3.chairman.name}
`);

  console.log('');
  console.log('Running test council...');
  console.log(`  Mode: ${pipelineConfig.mode}`);
  console.log(`  Responders: ${pipelineConfig.stage1.agents.length}`);
  console.log('');

  // Determine timeout based on preset (heavy models need more time)
  const isHeavyPreset = presetName.includes('thorough') || presetName.includes('heavy');
  const timeoutMs = isHeavyPreset ? 1200000 : 600000; // 20 minutes for heavy, 10 for others
  console.log(`  Timeout: ${timeoutMs / 60000} minutes${isHeavyPreset ? ' (heavy preset)' : ''}`);

  // Configure sectioned deduplication for test plans (enabled by default)
  if (isTestDedupEnabled() && pipelineConfig.mode === 'merge') {
    const evalSpec = getTestDedupEvaluatorSpec();
    console.log(`  Stage 2: Sectioned deduplication (${evalSpec})`);

    // Initialize stage2 with customHandler
    pipelineConfig.stage2 = {
      agents: [],
      customHandler: createTestSectionedDedupHandler(
        evalSpec,
        availableProviders,
        config,
        timeoutMs
      ),
    };
  } else if (!isTestDedupEnabled()) {
    console.log('  Stage 2: Deduplication disabled (TEST_COUNCIL_SKIP_DEDUP=true)');
  }

  // Check for resume mode - reuse existing Stage 1 and only run chairman
  const resumeStage1 = process.env.RESUME_STAGE1 === 'true';
  const stage1Path = join(STATE_DIR, 'test-council-stage1.json');

  let result: PipelineResult | null;

  if (resumeStage1 && existsSync(stage1Path)) {
    console.log('');
    console.log('RESUME MODE: Loading existing Stage 1 responses...');

    // Load saved Stage 1 data
    const savedStage1 = JSON.parse(readFileSync(stage1Path, 'utf-8'));
    const stage1Results: Stage1Result[] = savedStage1.responses.map((r: any) => ({
      agent: r.agent,
      response: r.response,
      summary: r.summary,
    }));

    // Extract actual model names from saved responses (not current config!)
    const actualModelsUsed = stage1Results.map(r => r.agent).join(', ');

    console.log(`  Loaded ${stage1Results.length} responses from: state/test-council-stage1.json`);
    console.log(`  Original timestamp: ${savedStage1.timestamp}`);
    console.log(`  Original preset: ${savedStage1.preset}`);
    console.log(`  Models in saved responses: ${actualModelsUsed}`);
    console.log('');

    // Run dedup if enabled (same as full pipeline)
    let dedupResult: Stage2CustomResult | null = null;
    if (isTestDedupEnabled() && pipelineConfig.stage2?.customHandler) {
      console.log('Running Stage 2 deduplication...');
      dedupResult = await pipelineConfig.stage2.customHandler(
        stage1Results,
        pipelineConfig.stage2.agents || [],
        timeoutMs
      );
    }

    // Build two-pass config
    const twoPassConfig: TwoPassConfig = pipelineConfig.stage3.twoPass || {
      enabled: true,
      pass1Tier: 'default',
      pass2Tier: 'default',
    };

    // Add custom formats if configured, but fix Pass 2 to use actual model names
    if (pipelineConfig.stage3.twoPass?.pass1Format) {
      twoPassConfig.pass1Format = pipelineConfig.stage3.twoPass.pass1Format;
      twoPassConfig.pass1IsCustomPrompt = pipelineConfig.stage3.twoPass.pass1IsCustomPrompt;
    }
    if (pipelineConfig.stage3.twoPass?.pass2Format) {
      // Replace the model list in Pass 2 format with actual models from saved responses
      twoPassConfig.pass2Format = pipelineConfig.stage3.twoPass.pass2Format
        .replace(modelsUsed, actualModelsUsed);
    }

    console.log(`Running chairman only (skipping Stage 1)...`);
    console.log(`  Chairman: ${pipelineConfig.stage3.chairman.name}`);
    console.log(`  Two-pass: Pass 1 (${twoPassConfig.pass1Tier}) → Pass 2 (${twoPassConfig.pass2Tier})`);
    console.log('');

    // Prepare chairman input - use dedup output if available
    let chairmanInput: Stage1Result[];
    if (dedupResult) {
      // Convert dedup sections to consolidated input for chairman
      const consolidatedMarkdown = buildConsolidatedMarkdown(dedupResult);
      chairmanInput = [{
        agent: 'dedup-consolidated',
        response: consolidatedMarkdown,
      }];
      console.log(`  Using deduplicated input (${consolidatedMarkdown.length} chars)`);
    } else {
      chairmanInput = stage1Results;
      console.log(`  Using raw Stage 1 input (${stage1Results.reduce((sum, r) => sum + r.response.length, 0)} chars)`);
    }

    // Run only the chairman merge
    const twoPassResult = await runTwoPassMergeChairman(
      testPrompt,
      chairmanInput,
      pipelineConfig.stage3.chairman,
      twoPassConfig,
      timeoutMs,
      false, // not silent
      { outputFormat: pipelineConfig.stage3.outputFormat }
    );

    console.log(`\nStage 3 complete: ${twoPassResult.pass1.agent} + ${twoPassResult.pass2.agent}`);
    log(`Stage 3 complete: ${twoPassResult.pass1.agent} + ${twoPassResult.pass2.agent}`);

    // Build result object matching PipelineResult structure
    result = {
      mode: 'merge',
      stage1: stage1Results,
      stage2: null,
      stage3: {
        agent: `${twoPassResult.pass1.agent} + ${twoPassResult.pass2.agent}`,
        response: twoPassResult.combined || twoPassResult.pass2.response || twoPassResult.pass1.response,
      },
      aggregate: null,
      twoPassResult,
    };
  } else {
    if (resumeStage1) {
      console.log('Warning: RESUME_STAGE1=true but no Stage 1 file found. Running full pipeline.');
    }

    // Run the full pipeline
    result = await runEnhancedPipeline(testPrompt, {
      config: pipelineConfig,
      timeoutMs,
      tty: options.tty ?? process.stdout.isTTY ?? false,
      silent: false,
      callbacks: {
        onStage1Complete: (results) => {
          console.log(`\nStage 1 complete: ${results.length} responses`);
          log(`Stage 1 complete: ${results.length} responses`);

          // Save Stage 1 responses for recovery if chairman fails
          const stage1Output = {
            timestamp: new Date().toISOString(),
            preset: presetName,
            responses: results.map(r => ({
              agent: r.agent,
              response_length: r.response.length,
              response: r.response,
              summary: r.summary,
            })),
          };
          writeFileSync(stage1Path, JSON.stringify(stage1Output, null, 2));
          console.log(`  Stage 1 responses saved to: state/test-council-stage1.json`);
        },
        onStage3Complete: (result) => {
          console.log(`\nStage 3 complete: ${result.agent}`);
          log(`Stage 3 complete: ${result.agent}`);
        },
      },
    });
  }

  if (!result) {
    const errorMsg = 'Test council failed - no result returned';
    console.error(errorMsg);
    return {
      success: false,
      error: errorMsg,
      durationMs: Date.now() - startTime,
    };
  }

  // Parse and structure the output
  console.log('\nProcessing results...');

  let testPlan: TestPlanOutput;
  try {
    // Try to parse chairman output as JSON
    const jsonMatch = result.stage3.response.match(/```json\s*([\s\S]*?)\s*```/);
    const jsonContent = jsonMatch ? jsonMatch[1] : result.stage3.response;
    const parsed = JSON.parse(jsonContent);

    const tests = parsed.tests || {
      unit: [],
      integration: [],
      e2e: [],
      security: [],
      performance: [],
      edge_cases: [],
    };

    // Compute accurate feature coverage from test data
    const featureCoverage = computeFeatureCoverage(
      tests,
      (spec as any).feature_manifest?.features
    );

    testPlan = {
      metadata: {
        project_id: projectName,
        spec_version: version,
        generated_at: new Date().toISOString(),
        total_tests: countTests(tests),
        preset_used: presetName,
      },
      tests,
      coverage_summary: {
        // Use computed coverage (more accurate than chairman output)
        features_covered: featureCoverage.features_covered,
        features_uncovered: featureCoverage.features_uncovered,
        coverage_percentage: featureCoverage.coverage_percentage,
        // Preserve gaps_identified from chairman analysis
        gaps_identified: parsed.coverage_summary?.gaps_identified || [],
        quantifiability: computeQuantifiabilityStats(tests),
      },
      merge_metadata: {
        models_used: result.stage1.map(r => r.agent),
        unique_contributions: result.stage1.map(r => ({
          source: r.agent,
          count: countTestsInResponse(r.response),
        })),
        attribution_summary: computeAttributionSummary(tests),
      },
    };
  } catch (e) {
    console.warn('Warning: Could not parse structured JSON output');
    console.warn('Saving raw output instead');

    testPlan = {
      metadata: {
        project_id: projectName,
        spec_version: version,
        generated_at: new Date().toISOString(),
        total_tests: 0,
        preset_used: presetName,
      },
      tests: {
        unit: [],
        integration: [],
        e2e: [],
        security: [],
        performance: [],
        edge_cases: [],
      },
      coverage_summary: {
        features_covered: [],
        gaps_identified: ['Failed to parse structured output - see raw_output'],
      },
      merge_metadata: {
        models_used: result.stage1.map(r => r.agent),
        unique_contributions: [],
      },
    };

    // Save raw output separately
    writeFileSync(
      join(STATE_DIR, 'test-plan-raw.txt'),
      result.stage3.response
    );
  }

  // Save the test plan
  const outputPath = join(STATE_DIR, 'test-plan-output.json');
  writeFileSync(outputPath, JSON.stringify(testPlan, null, 2));

  // Write test links back to spec-final.json (Stage 4: bidirectional traceability)
  // Note: specPath already declared earlier in main()
  const linkResult = writeTestLinksToSpec(specPath, testPlan.tests);

  log(`
Test council complete
Total tests: ${testPlan.metadata.total_tests}
Output: state/test-plan-output.json
Traceability: ${linkResult.featuresUpdated} features linked to ${linkResult.testsLinked} tests
`);

  console.log('');
  console.log('='.repeat(60));
  console.log('Test Plan Generated');
  console.log('='.repeat(60));
  console.log(`  Total tests: ${testPlan.metadata.total_tests}`);
  console.log(`  Unit: ${testPlan.tests.unit.length}`);
  console.log(`  Integration: ${testPlan.tests.integration.length}`);
  console.log(`  E2E: ${testPlan.tests.e2e.length}`);
  console.log(`  Security: ${testPlan.tests.security.length}`);
  console.log(`  Performance: ${testPlan.tests.performance.length}`);
  console.log(`  Edge Cases: ${testPlan.tests.edge_cases.length}`);

  // Quantifiability summary
  const quantStats = testPlan.coverage_summary.quantifiability;
  if (quantStats && quantStats.needs_clarification > 0) {
    console.log('');
    console.log(`  Quantifiability: ${quantStats.quantifiable}/${quantStats.total_tests} tests have clear acceptance criteria`);
    console.log(`  Needs clarification: ${quantStats.needs_clarification} tests`);
    console.log('  Run "npm run test-finalize" to generate clarification report');
  }

  // Feature coverage summary
  const coveragePct = testPlan.coverage_summary.coverage_percentage;
  const totalFeatures = testPlan.coverage_summary.features_covered.length +
                       (testPlan.coverage_summary.features_uncovered?.length || 0);
  if (totalFeatures > 0) {
    console.log('');
    console.log('  Feature Coverage:');
    console.log(`    ${testPlan.coverage_summary.features_covered.length}/${totalFeatures} features covered (${coveragePct}%)`);
    if (testPlan.coverage_summary.features_uncovered && testPlan.coverage_summary.features_uncovered.length > 0) {
      console.log(`    Uncovered: ${testPlan.coverage_summary.features_uncovered.join(', ')}`);
    }
  }

  // Traceability summary (spec write-back)
  if (linkResult.written) {
    console.log('');
    console.log('  Spec Updated:');
    console.log(`    validated_by_tests added to ${linkResult.featuresUpdated} features`);
  }

  console.log('');
  console.log(`Output: state/test-plan-output.json`);

  // Return success result
  return {
    success: true,
    outputPath,
    testPlan,
    totalTests: testPlan.metadata.total_tests,
    durationMs: Date.now() - startTime,
  };
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main() {
  const result = await runTestCouncil();
  process.exit(result.success ? 0 : 1);
}

// Only run main if this file is executed directly (not imported)
const isMainModule = process.argv[1]?.includes('test-council');
if (isMainModule) {
  main().catch((error) => {
    console.error('Test council failed:', error);
    process.exit(1);
  });
}

function countTests(tests: TestPlanOutput['tests']): number {
  if (!tests) return 0;
  return (
    (tests.unit?.length || 0) +
    (tests.integration?.length || 0) +
    (tests.e2e?.length || 0) +
    (tests.security?.length || 0) +
    (tests.performance?.length || 0) +
    (tests.edge_cases?.length || 0)
  );
}

function computeAttributionSummary(tests: TestPlanOutput['tests']): NonNullable<NonNullable<TestPlanOutput['merge_metadata']>['attribution_summary']> {
  const allTests: TestCase[] = [
    ...(tests.unit || []),
    ...(tests.integration || []),
    ...(tests.e2e || []),
    ...(tests.security || []),
    ...(tests.performance || []),
    ...(tests.edge_cases || []),
  ];

  let uniqueTests = 0;
  let mergedTests = 0;
  const byModel: Record<string, number> = {};

  for (const test of allTests) {
    if (test.source?.model) {
      // Count by primary model
      byModel[test.source.model] = (byModel[test.source.model] || 0) + 1;

      // Check if merged from multiple
      if (test.source.merged_from && test.source.merged_from.length > 0) {
        mergedTests++;
        // Also count the models it was merged from
        for (const model of test.source.merged_from) {
          byModel[model] = (byModel[model] || 0) + 1;
        }
      } else {
        uniqueTests++;
      }
    }
  }

  return {
    unique_tests: uniqueTests,
    merged_tests: mergedTests,
    by_model: byModel,
  };
}

function computeQuantifiabilityStats(tests: TestPlanOutput['tests']): NonNullable<TestPlanOutput['coverage_summary']['quantifiability']> {
  const allTests: TestCase[] = [
    ...(tests.unit || []),
    ...(tests.integration || []),
    ...(tests.e2e || []),
    ...(tests.security || []),
    ...(tests.performance || []),
    ...(tests.edge_cases || []),
  ];

  const totalTests = allTests.length;
  const needsClarification = allTests.filter(t => t.quantifiable === false).length;
  const quantifiable = totalTests - needsClarification;

  return {
    total_tests: totalTests,
    quantifiable,
    needs_clarification: needsClarification,
  };
}

/**
 * Computes feature coverage from tests validates_features field.
 * Returns accurate stats based on actual test-feature linkages.
 */
function computeFeatureCoverage(
  tests: TestPlanOutput['tests'],
  featureManifest: FeatureManifestEntry[] | undefined
): { features_covered: string[]; features_uncovered: string[]; coverage_percentage: number } {
  // If no feature manifest, return empty stats
  if (!featureManifest || featureManifest.length === 0) {
    return {
      features_covered: [],
      features_uncovered: [],
      coverage_percentage: 0,
    };
  }

  // Get all feature IDs
  const allFeatureIds = new Set(featureManifest.map(f => f.id));

  // Collect all tests
  const allTests: TestCase[] = [
    ...(tests.unit || []),
    ...(tests.integration || []),
    ...(tests.e2e || []),
    ...(tests.security || []),
    ...(tests.performance || []),
    ...(tests.edge_cases || []),
  ];

  // Find which features have at least one test
  const coveredFeatures = new Set<string>();
  for (const test of allTests) {
    if (test.validates_features && Array.isArray(test.validates_features)) {
      for (const featId of test.validates_features) {
        if (allFeatureIds.has(featId)) {
          coveredFeatures.add(featId);
        }
      }
    }
  }

  // Compute uncovered features
  const uncoveredFeatures = [...allFeatureIds].filter(id => !coveredFeatures.has(id));

  // Calculate percentage
  const totalFeatures = allFeatureIds.size;
  const coveragePercentage = totalFeatures > 0
    ? Math.round((coveredFeatures.size / totalFeatures) * 100)
    : 0;

  return {
    features_covered: [...coveredFeatures].sort(),
    features_uncovered: uncoveredFeatures.sort(),
    coverage_percentage: coveragePercentage,
  };
}

function countTestsInResponse(response: string): number {
  // Simple heuristic: count test IDs
  const matches = response.match(/[A-Z]+-\d{3}/g);
  return matches ? matches.length : 0;
}

/**
 * Writes validated_by_tests back to spec-final.json for each feature.
 * Creates a bidirectional link: spec knows which tests validate each feature,
 * tests know which features they validate.
 */
function writeTestLinksToSpec(
  specPath: string,
  tests: TestPlanOutput['tests']
): { written: boolean; featuresUpdated: number; testsLinked: number } {
  if (!existsSync(specPath)) {
    console.warn('  Warning: spec-final.json not found, skipping test link write-back');
    return { written: false, featuresUpdated: 0, testsLinked: 0 };
  }

  const spec = JSON.parse(readFileSync(specPath, 'utf-8'));

  // Check if spec has feature_manifest
  if (!spec.feature_manifest?.features || !Array.isArray(spec.feature_manifest.features)) {
    console.warn('  Warning: spec-final.json has no feature_manifest, skipping test link write-back');
    return { written: false, featuresUpdated: 0, testsLinked: 0 };
  }

  // Build reverse mapping: feature -> tests
  const featureToTests: Record<string, string[]> = {};
  for (const feature of spec.feature_manifest.features) {
    featureToTests[feature.id] = [];
  }

  // Collect all tests
  const allTests: TestCase[] = [
    ...(tests.unit || []),
    ...(tests.integration || []),
    ...(tests.e2e || []),
    ...(tests.security || []),
    ...(tests.performance || []),
    ...(tests.edge_cases || []),
  ];

  let testsLinked = 0;
  for (const test of allTests) {
    if (test.validates_features && Array.isArray(test.validates_features)) {
      for (const featId of test.validates_features) {
        if (featureToTests[featId] !== undefined) {
          featureToTests[featId].push(test.id);
          testsLinked++;
        }
      }
    }
  }

  // Update spec with reverse mapping
  let featuresUpdated = 0;
  for (const feature of spec.feature_manifest.features) {
    const linkedTests = featureToTests[feature.id] || [];
    if (linkedTests.length > 0) {
      feature.validated_by_tests = linkedTests;
      featuresUpdated++;
    } else {
      // Clear any stale data
      delete feature.validated_by_tests;
    }
  }

  spec.feature_manifest.tests_linked_at = new Date().toISOString();

  writeFileSync(specPath, JSON.stringify(spec, null, 2));

  return { written: true, featuresUpdated, testsLinked };
}
