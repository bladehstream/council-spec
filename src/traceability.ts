/**
 * Traceability CLI - Query feature-to-test relationships
 *
 * Usage:
 *   npm run traceability                     # Summary: coverage %, gaps
 *   npm run traceability feature FEAT-001    # List tests for a feature
 *   npm run traceability test UNIT-001       # List features a test validates
 *   npm run traceability gaps                # List features with no tests
 *   npm run traceability check               # CI: exit 1 if must_have features lack tests
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const STATE_DIR = join(ROOT, 'state');

// ============================================================================
// Types
// ============================================================================

interface FeatureManifestEntry {
  id: string;
  name: string;
  description: string;
  priority: 'must_have' | 'should_have' | 'nice_to_have';
  acceptance_criteria?: string[];
  validated_by_tests?: string[];
}

interface FeatureManifest {
  features: FeatureManifestEntry[];
  generated_at: string;
  tests_linked_at?: string;
}

interface TestCase {
  id: string;
  name: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  validates_features?: string[];
}

interface TestPlanOutput {
  metadata: {
    project_id: string;
    spec_version: string;
    generated_at: string;
    total_tests: number;
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
    features_uncovered?: string[];
    coverage_percentage?: number;
  };
}

interface SpecFinal {
  project_id?: string;
  feature_manifest?: FeatureManifest;
}

// ============================================================================
// Data Loading
// ============================================================================

function loadSpec(): SpecFinal | null {
  const path = join(STATE_DIR, 'spec-final.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function loadTestPlan(): TestPlanOutput | null {
  const path = join(STATE_DIR, 'test-plan-output.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function getAllTests(testPlan: TestPlanOutput): TestCase[] {
  return [
    ...(testPlan.tests.unit || []),
    ...(testPlan.tests.integration || []),
    ...(testPlan.tests.e2e || []),
    ...(testPlan.tests.security || []),
    ...(testPlan.tests.performance || []),
    ...(testPlan.tests.edge_cases || []),
  ];
}

// ============================================================================
// Commands
// ============================================================================

function showSummary(spec: SpecFinal, testPlan: TestPlanOutput | null): void {
  console.log('');
  console.log('Feature-to-Test Traceability Report');
  console.log('====================================');
  console.log('');

  const features = spec.feature_manifest?.features || [];
  if (features.length === 0) {
    console.log('No features found in spec-final.json');
    console.log('Run "npm run finalize" to generate feature manifest');
    return;
  }

  const covered = features.filter(f => f.validated_by_tests?.length).length;
  const total = features.length;
  const pct = total > 0 ? Math.round((covered / total) * 100) : 0;

  console.log(`Coverage: ${covered}/${total} features (${pct}%)`);
  console.log('');

  // Show each feature with its test status
  for (const feature of features) {
    const testCount = feature.validated_by_tests?.length || 0;
    const status = testCount > 0 ? '✓' : '✗';
    const priority = feature.priority === 'must_have' ? '[must_have]' : '';
    const warning = testCount === 0 && feature.priority === 'must_have' ? ' - NEEDS COVERAGE' : '';

    console.log(`${status} ${feature.id}: ${feature.name.substring(0, 35).padEnd(35)} → ${testCount} tests ${priority}${warning}`);
  }

  console.log('');
  console.log('Run "npm run traceability feature <ID>" to see tests for a specific feature.');
}

function showFeatureTests(featureId: string, spec: SpecFinal, testPlan: TestPlanOutput | null): void {
  const features = spec.feature_manifest?.features || [];
  const feature = features.find(f => f.id === featureId);

  if (!feature) {
    console.error(`Feature not found: ${featureId}`);
    console.log('Available features:');
    for (const f of features) {
      console.log(`  ${f.id}: ${f.name}`);
    }
    process.exit(1);
  }

  console.log('');
  console.log(`Feature: ${feature.id} - ${feature.name}`);
  console.log(`Priority: ${feature.priority}`);
  console.log('');

  if (feature.description) {
    console.log(`Description: ${feature.description}`);
    console.log('');
  }

  const tests = feature.validated_by_tests || [];
  if (tests.length === 0) {
    console.log('No tests validate this feature.');
    return;
  }

  console.log(`Tests (${tests.length}):`);
  console.log('');

  // Get test details from test plan
  if (testPlan) {
    const allTests = getAllTests(testPlan);
    for (const testId of tests) {
      const test = allTests.find(t => t.id === testId);
      if (test) {
        console.log(`  ${test.id}: ${test.name}`);
        console.log(`    Priority: ${test.priority} | Category: ${test.category}`);
      } else {
        console.log(`  ${testId}: (details not found)`);
      }
    }
  } else {
    for (const testId of tests) {
      console.log(`  ${testId}`);
    }
  }
}

function showTestFeatures(testId: string, testPlan: TestPlanOutput | null, spec: SpecFinal): void {
  if (!testPlan) {
    console.error('Test plan not found. Run "npm run test-council" first.');
    process.exit(1);
  }

  const allTests = getAllTests(testPlan);
  const test = allTests.find(t => t.id === testId);

  if (!test) {
    console.error(`Test not found: ${testId}`);
    console.log('Use test IDs like UNIT-001, INT-002, etc.');
    process.exit(1);
  }

  console.log('');
  console.log(`Test: ${test.id} - ${test.name}`);
  console.log(`Priority: ${test.priority} | Category: ${test.category}`);
  console.log('');

  const featureIds = test.validates_features || [];
  if (featureIds.length === 0) {
    console.log('This test has no feature linkages.');
    return;
  }

  console.log(`Validates (${featureIds.length}):`);
  console.log('');

  const features = spec.feature_manifest?.features || [];
  for (const featId of featureIds) {
    const feature = features.find(f => f.id === featId);
    if (feature) {
      console.log(`  ${feature.id}: ${feature.name}`);
      console.log(`    Priority: ${feature.priority}`);
    } else {
      console.log(`  ${featId}: (details not found)`);
    }
  }
}

function showGaps(spec: SpecFinal): void {
  console.log('');
  console.log('Features Without Test Coverage');
  console.log('==============================');
  console.log('');

  const features = spec.feature_manifest?.features || [];
  const gaps = features.filter(f => !f.validated_by_tests?.length);

  if (gaps.length === 0) {
    console.log('All features have test coverage!');
    return;
  }

  // Sort by priority: must_have first
  const sorted = [...gaps].sort((a, b) => {
    const order = { must_have: 0, should_have: 1, nice_to_have: 2 };
    return (order[a.priority] || 3) - (order[b.priority] || 3);
  });

  for (const feature of sorted) {
    const priority = feature.priority === 'must_have' ? '[must_have] ⚠' : `[${feature.priority}]`;
    console.log(`${feature.id}: ${feature.name}`);
    console.log(`  Priority: ${priority}`);
    console.log('');
  }

  const mustHaveGaps = gaps.filter(f => f.priority === 'must_have').length;
  if (mustHaveGaps > 0) {
    console.log(`Warning: ${mustHaveGaps} must_have feature(s) have no tests!`);
  }
}

function checkCoverage(spec: SpecFinal): void {
  const features = spec.feature_manifest?.features || [];
  const mustHaveGaps = features.filter(
    f => f.priority === 'must_have' && !f.validated_by_tests?.length
  );

  if (mustHaveGaps.length > 0) {
    console.error('ERROR: The following must_have features have no test coverage:');
    console.error('');
    for (const feature of mustHaveGaps) {
      console.error(`  ${feature.id}: ${feature.name}`);
    }
    console.error('');
    console.error('Run "npm run test-council" to generate tests for these features.');
    process.exit(1);
  }

  const covered = features.filter(f => f.validated_by_tests?.length).length;
  const total = features.length;
  const pct = total > 0 ? Math.round((covered / total) * 100) : 0;

  console.log(`OK: All must_have features have test coverage (${pct}% overall)`);
}

// ============================================================================
// Main
// ============================================================================

const args = process.argv.slice(2);
const command = args[0];

const spec = loadSpec();
if (!spec) {
  console.error('Error: state/spec-final.json not found');
  console.error('Run "npm run finalize" first to generate the specification');
  process.exit(1);
}

const testPlan = loadTestPlan();

switch (command) {
  case 'feature':
    if (!args[1]) {
      console.error('Usage: npm run traceability feature <FEAT-ID>');
      process.exit(1);
    }
    showFeatureTests(args[1], spec, testPlan);
    break;

  case 'test':
    if (!args[1]) {
      console.error('Usage: npm run traceability test <TEST-ID>');
      process.exit(1);
    }
    showTestFeatures(args[1], testPlan, spec);
    break;

  case 'gaps':
    showGaps(spec);
    break;

  case 'check':
    checkCoverage(spec);
    break;

  default:
    showSummary(spec, testPlan);
    break;
}
