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
  getPreset,
  buildPipelineConfig,
  listProviders,
  loadModelsConfig,
  createAgentFromSpec,
  type EnhancedPipelineConfig,
  type PipelineResult,
} from 'agent-council';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const STATE_DIR = join(ROOT, 'state');

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
    gaps_identified: string[];
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
7. Which parts of the spec it covers

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
    "features_covered": ["Feature A", "Feature B"],
    "gaps_identified": ["Any areas not fully tested"]
  }
}
\`\`\`

Be thorough. Include edge cases. Think about what could go wrong.
`;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('='.repeat(60));
  console.log('TEST COUNCIL - Generate Test Plan via Merge Mode');
  console.log('='.repeat(60));
  console.log('');

  // Check for spec-final.json
  const specPath = join(STATE_DIR, 'spec-final.json');
  if (!existsSync(specPath)) {
    console.error('Error: state/spec-final.json not found');
    console.error('Run "npm run finalize" first to generate the specification');
    process.exit(1);
  }

  const spec: ExtendedSpec = JSON.parse(readFileSync(specPath, 'utf-8'));
  const projectName = spec.metadata?.project_name || spec.project_id || 'Unknown Project';
  const version = spec.metadata?.version || '1.0.0';
  console.log(`Loaded spec: ${projectName} v${version}`);

  // Determine preset (TEST_COUNCIL_PRESET overrides COUNCIL_PRESET for test-specific presets)
  const presetName = process.env.TEST_COUNCIL_PRESET || process.env.COUNCIL_PRESET || 'merge-balanced';
  console.log(`Using preset: ${presetName}`);

  // Load config and get available providers
  const config = loadModelsConfig();
  const availableProviders = listProviders(config).filter(p => {
    // Simple check - in production you'd verify the CLI exists
    return true;
  });

  if (availableProviders.length === 0) {
    console.error('Error: No providers available');
    process.exit(1);
  }

  console.log(`Available providers: ${availableProviders.join(', ')}`);

  // Get preset and build pipeline config
  const preset = getPreset(presetName, config);
  const pipelineConfig = buildPipelineConfig(preset, availableProviders, config);

  // Apply environment variable overrides
  if (process.env.COUNCIL_CHAIRMAN) {
    const chairmanSpec = process.env.COUNCIL_CHAIRMAN;
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

  if (process.env.COUNCIL_RESPONDERS) {
    const respondersSpec = process.env.COUNCIL_RESPONDERS;
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
    pipelineConfig.stage3.twoPass.pass1Format = `You are merging test plans from multiple AI models.
Your task is to combine all tests into a single comprehensive list.

The models providing tests are: ${modelsUsed}

For each test, note which model(s) contributed it using this format:
[MODEL: model_name] Test Name - Description

Instructions:
1. List ALL unique tests from all responses
2. For duplicate/similar tests, keep ONE version and note ALL models that suggested it
3. Group tests by category (unit, integration, e2e, security, performance, edge_cases)
4. Identify any gaps - important test scenarios not covered by any model

Output format (plain text, NOT JSON):

## UNIT TESTS
[MODEL: claude:heavy] Test Name - Brief description
[MODEL: gemini:heavy, claude:heavy] Test Name - Brief description (similar tests merged)
...

## INTEGRATION TESTS
...

## E2E TESTS
...

## SECURITY TESTS
...

## PERFORMANCE TESTS
...

## EDGE CASE TESTS
...

## COVERAGE GAPS
- Gap 1: Description of missing test scenario
- Gap 2: ...

## MERGE NOTES
Brief notes on deduplication decisions made`;

    pipelineConfig.stage3.twoPass.pass2Format = `Convert the merged test list from Pass 1 into structured JSON.

CRITICAL: Output ONLY valid JSON, no markdown code fences, no additional text.

The models used were: ${modelsUsed}

For source attribution:
- Extract model name from [MODEL: xxx] tags
- If multiple models listed, use first as source.model, rest as source.merged_from
- For tests you create to fill gaps, use source.model = "chairman" and source.created_by_chairman = true

JSON structure:
{
  "tests": {
    "unit": [{"id": "UNIT-001", "name": "...", "description": "...", "priority": "high|medium|low", "category": "...", "steps": ["..."], "expected_result": "...", "source": {"model": "...", "merged_from": ["..."]}}],
    "integration": [...],
    "e2e": [...],
    "security": [...],
    "performance": [...],
    "edge_cases": [...]
  },
  "coverage_summary": {
    "features_covered": ["..."],
    "gaps_identified": ["..."]
  },
  "merge_notes": "..."
}`;
  }

  pipelineConfig.stage3.outputFormat = `Output the merged test plan as JSON. Combine all tests from all responses.
Deduplicate similar tests, keeping the most detailed version.
Include ALL unique test ideas from every response.

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
    "features_covered": [...],
    "gaps_identified": [...]
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

  // Run the pipeline
  const result = await runEnhancedPipeline(testPrompt, {
    config: pipelineConfig,
    timeoutMs,
    tty: process.stdout.isTTY ?? false,
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
        const stage1Path = join(STATE_DIR, 'test-council-stage1.json');
        writeFileSync(stage1Path, JSON.stringify(stage1Output, null, 2));
        console.log(`  Stage 1 responses saved to: state/test-council-stage1.json`);
      },
      onStage3Complete: (result) => {
        console.log(`\nStage 3 complete: ${result.agent}`);
        log(`Stage 3 complete: ${result.agent}`);
      },
    },
  });

  if (!result) {
    console.error('Test council failed - no result returned');
    process.exit(1);
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
        ...(parsed.coverage_summary || {
          features_covered: [],
          gaps_identified: [],
        }),
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

  log(`
Test council complete
Total tests: ${testPlan.metadata.total_tests}
Output: state/test-plan-output.json
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

  console.log('');
  console.log(`Output: state/test-plan-output.json`);
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

function countTestsInResponse(response: string): number {
  // Simple heuristic: count test IDs
  const matches = response.match(/[A-Z]+-\d{3}/g);
  return matches ? matches.length : 0;
}

main().catch((error) => {
  console.error('Test council failed:', error);
  process.exit(1);
});
