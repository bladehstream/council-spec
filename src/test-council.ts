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
  };
  merge_metadata?: {
    models_used: string[];
    unique_contributions: Array<{
      source: string;
      count: number;
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

  // Determine preset
  const presetName = process.env.TEST_COUNCIL_PRESET || 'merge-balanced';
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

  // Override stage1 prompt with our test plan prompt
  const testPrompt = buildTestPlanPrompt(spec);
  pipelineConfig.stage1.prompt = testPrompt;

  // Set output format for chairman
  pipelineConfig.stage3.outputFormat = `Output the merged test plan as JSON. Combine all tests from all responses.
Deduplicate similar tests, keeping the most detailed version.
Include ALL unique test ideas from every response.

JSON structure:
{
  "tests": {
    "unit": [...],
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

  // Run the pipeline
  const result = await runEnhancedPipeline(testPrompt, {
    config: pipelineConfig,
    timeoutMs: 600000, // 10 minutes
    tty: process.stdout.isTTY ?? false,
    silent: false,
    callbacks: {
      onStage1Complete: (results) => {
        console.log(`\nStage 1 complete: ${results.length} responses`);
        log(`Stage 1 complete: ${results.length} responses`);
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

    testPlan = {
      metadata: {
        project_id: projectName,
        spec_version: version,
        generated_at: new Date().toISOString(),
        total_tests: countTests(parsed.tests),
        preset_used: presetName,
      },
      tests: parsed.tests || {
        unit: [],
        integration: [],
        e2e: [],
        security: [],
        performance: [],
        edge_cases: [],
      },
      coverage_summary: parsed.coverage_summary || {
        features_covered: [],
        gaps_identified: [],
      },
      merge_metadata: {
        models_used: result.stage1.map(r => r.agent),
        unique_contributions: result.stage1.map(r => ({
          source: r.agent,
          count: countTestsInResponse(r.response),
        })),
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

function countTestsInResponse(response: string): number {
  // Simple heuristic: count test IDs
  const matches = response.match(/[A-Z]+-\d{3}/g);
  return matches ? matches.length : 0;
}

main().catch((error) => {
  console.error('Test council failed:', error);
  process.exit(1);
});
