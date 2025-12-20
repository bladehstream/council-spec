/**
 * Export Tests - Convert test-plan-output.json to human-readable markdown
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  createTable,
  formatDate,
  priorityBadge,
  hr,
  formatBulletList,
  createTOC,
  truncate,
} from './markdown-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const STATE_DIR = join(ROOT, 'state');

// ============================================================================
// Types
// ============================================================================

interface TestSource {
  model: string;              // Primary contributor (e.g., "claude:default" or "chairman")
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
      unique_tests: number;
      merged_tests: number;
      by_model: Record<string, number>;
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
// Markdown Generation
// ============================================================================

function generateTestTable(tests: TestCase[]): string {
  if (!tests || tests.length === 0) {
    return '_No tests in this category_\n';
  }

  const rows = tests.map(t => [
    `**${t.id}**`,
    t.name,
    priorityBadge(t.priority),
    t.category,
    truncate(t.expected_result, 50),
  ]);

  return createTable(
    ['ID', 'Name', 'Priority', 'Category', 'Expected Result'],
    rows
  );
}

function formatSourceAttribution(source?: TestSource): string {
  if (!source?.model) return '';

  let attribution: string;

  if (source.created_by_chairman || source.model === 'chairman') {
    attribution = `**Source:** Chairman (gap analysis)`;
  } else {
    attribution = `**Source:** ${source.model}`;

    if (source.merged_from && source.merged_from.length > 0) {
      attribution += ` (also in: ${source.merged_from.join(', ')})`;
    }
  }

  if (source.similarity_note) {
    attribution += `\n*${source.similarity_note}*`;
  }

  return attribution + '\n';
}

function generateDetailedTests(tests: TestCase[], sectionName: string): string {
  if (!tests || tests.length === 0) {
    return '';
  }

  const lines: string[] = [];
  lines.push(`### ${sectionName} - Detailed\n`);

  for (const test of tests) {
    lines.push(`#### ${test.id}: ${test.name}\n`);
    lines.push(`**Priority:** ${priorityBadge(test.priority)}  `);
    lines.push(`**Category:** ${test.category}\n`);

    // Add split_from if this test was split from another
    if (test.split_from) {
      lines.push(`**Split from:** ${test.split_from}\n`);
    }

    // Add atomicity warning if split is recommended but not done
    if (test.atomicity === 'split_recommended') {
      lines.push(`\n> **Note:** This test is marked for splitting into atomic units.\n`);
      if (test.split_suggestion?.length) {
        lines.push(`> Suggested splits: ${test.split_suggestion.join(', ')}\n`);
      }
    }

    // Add quantifiability warning if acceptance criteria is unclear
    if (test.quantifiable === false) {
      lines.push(`\n> **Warning:** This test needs spec clarification.\n`);
      if (test.clarification_needed) {
        lines.push(`> ${test.clarification_needed}\n`);
      }
      if (test.suggested_threshold) {
        lines.push(`> *AI Suggestion:* ${test.suggested_threshold}\n`);
      }
    }

    // Add source attribution if available
    const sourceAttr = formatSourceAttribution(test.source);
    if (sourceAttr) {
      lines.push(sourceAttr);
    }

    lines.push('\n**Description:**\n');
    lines.push(test.description + '\n');

    if (test.preconditions?.length) {
      lines.push('\n**Preconditions:**\n');
      lines.push(formatBulletList(test.preconditions));
    }

    if (test.steps?.length) {
      lines.push('\n**Steps:**\n');
      test.steps.forEach((step, i) => {
        lines.push(`${i + 1}. ${step}\n`);
      });
    }

    lines.push('\n**Expected Result:**\n');
    lines.push(test.expected_result + '\n');

    if (test.coverage?.length) {
      lines.push('\n**Coverage:**\n');
      lines.push(formatBulletList(test.coverage));
    }

    lines.push('');
  }

  return lines.join('\n');
}

function generateMarkdown(plan: TestPlanOutput): string {
  const lines: string[] = [];

  // Title and metadata
  lines.push(`# Test Plan: ${plan.metadata.project_id}\n`);
  lines.push(`**Spec Version:** ${plan.metadata.spec_version}  `);
  lines.push(`**Generated:** ${formatDate(plan.metadata.generated_at)}  `);
  lines.push(`**Total Tests:** ${plan.metadata.total_tests}  `);
  lines.push(`**Preset Used:** ${plan.metadata.preset_used}\n`);

  // Summary stats
  lines.push('\n## Test Summary\n');
  const stats = [
    ['Unit Tests', plan.tests.unit?.length || 0],
    ['Integration Tests', plan.tests.integration?.length || 0],
    ['E2E Tests', plan.tests.e2e?.length || 0],
    ['Security Tests', plan.tests.security?.length || 0],
    ['Performance Tests', plan.tests.performance?.length || 0],
    ['Edge Cases', plan.tests.edge_cases?.length || 0],
  ];
  lines.push(createTable(['Category', 'Count'], stats.map(s => [String(s[0]), String(s[1])])));

  // Priority breakdown
  const allTests = [
    ...(plan.tests.unit || []),
    ...(plan.tests.integration || []),
    ...(plan.tests.e2e || []),
    ...(plan.tests.security || []),
    ...(plan.tests.performance || []),
    ...(plan.tests.edge_cases || []),
  ];

  const priorityCounts = {
    critical: allTests.filter(t => t.priority === 'critical').length,
    high: allTests.filter(t => t.priority === 'high').length,
    medium: allTests.filter(t => t.priority === 'medium').length,
    low: allTests.filter(t => t.priority === 'low').length,
  };

  lines.push('\n### Priority Breakdown\n');
  lines.push(createTable(
    ['Priority', 'Count'],
    [
      [priorityBadge('critical'), String(priorityCounts.critical)],
      [priorityBadge('high'), String(priorityCounts.high)],
      [priorityBadge('medium'), String(priorityCounts.medium)],
      [priorityBadge('low'), String(priorityCounts.low)],
    ]
  ));

  // Table of Contents
  lines.push('\n## Table of Contents\n');
  const tocHeadings = [
    { level: 2, text: 'Unit Tests' },
    { level: 2, text: 'Integration Tests' },
    { level: 2, text: 'E2E Tests' },
    { level: 2, text: 'Security Tests' },
    { level: 2, text: 'Performance Tests' },
    { level: 2, text: 'Edge Cases' },
    { level: 2, text: 'Coverage Summary' },
  ];
  lines.push(createTOC(tocHeadings));

  lines.push(hr());

  // Unit Tests
  lines.push('## Unit Tests\n');
  lines.push(generateTestTable(plan.tests.unit));
  lines.push(generateDetailedTests(plan.tests.unit, 'Unit Tests'));
  lines.push(hr());

  // Integration Tests
  lines.push('## Integration Tests\n');
  lines.push(generateTestTable(plan.tests.integration));
  lines.push(generateDetailedTests(plan.tests.integration, 'Integration Tests'));
  lines.push(hr());

  // E2E Tests
  lines.push('## E2E Tests\n');
  lines.push(generateTestTable(plan.tests.e2e));
  lines.push(generateDetailedTests(plan.tests.e2e, 'E2E Tests'));
  lines.push(hr());

  // Security Tests
  lines.push('## Security Tests\n');
  lines.push(generateTestTable(plan.tests.security));
  lines.push(generateDetailedTests(plan.tests.security, 'Security Tests'));
  lines.push(hr());

  // Performance Tests
  lines.push('## Performance Tests\n');
  lines.push(generateTestTable(plan.tests.performance));
  lines.push(generateDetailedTests(plan.tests.performance, 'Performance Tests'));
  lines.push(hr());

  // Edge Cases
  lines.push('## Edge Cases\n');
  lines.push(generateTestTable(plan.tests.edge_cases));
  lines.push(generateDetailedTests(plan.tests.edge_cases, 'Edge Cases'));
  lines.push(hr());

  // Coverage Summary
  lines.push('## Coverage Summary\n');

  lines.push('### Features Covered\n');
  if (plan.coverage_summary.features_covered?.length) {
    lines.push(formatBulletList(plan.coverage_summary.features_covered));
  } else {
    lines.push('_Not specified_\n');
  }

  lines.push('\n### Gaps Identified\n');
  if (plan.coverage_summary.gaps_identified?.length) {
    lines.push(formatBulletList(plan.coverage_summary.gaps_identified));
  } else {
    lines.push('_No gaps identified_\n');
  }

  // Quantifiability summary
  if (plan.coverage_summary.quantifiability) {
    const quant = plan.coverage_summary.quantifiability;
    lines.push('\n### Quantifiability\n');
    lines.push(`- **Total tests:** ${quant.total_tests}\n`);
    lines.push(`- **Quantifiable:** ${quant.quantifiable}\n`);
    lines.push(`- **Needs clarification:** ${quant.needs_clarification}\n`);
    if (quant.clarification_report) {
      lines.push(`\nSee [${quant.clarification_report}](${quant.clarification_report}) for details.\n`);
    }
  }

  // Merge metadata
  if (plan.merge_metadata) {
    lines.push(hr());
    lines.push('## Generation Details\n');
    lines.push('### Models Used\n');
    lines.push(formatBulletList(plan.merge_metadata.models_used));

    if (plan.merge_metadata.unique_contributions?.length) {
      lines.push('\n### Contributions by Model (Stage 1)\n');
      const contribRows = plan.merge_metadata.unique_contributions.map(c => [
        c.source,
        String(c.count),
      ]);
      lines.push(createTable(['Model', 'Tests Proposed'], contribRows));
    }

    // Attribution summary (final merged counts)
    if (plan.merge_metadata.attribution_summary) {
      const attr = plan.merge_metadata.attribution_summary;
      lines.push('\n### Attribution Summary (Final Output)\n');
      lines.push(`- **Unique tests** (single model): ${attr.unique_tests}\n`);
      lines.push(`- **Merged tests** (multiple models): ${attr.merged_tests}\n`);

      if (Object.keys(attr.by_model).length > 0) {
        lines.push('\n**Tests by Model (including merged):**\n');
        const attrRows = Object.entries(attr.by_model)
          .sort((a, b) => b[1] - a[1])
          .map(([model, count]) => [model, String(count)]);
        lines.push(createTable(['Model', 'Tests Contributed'], attrRows));
      }
    }
  }

  // Split metadata
  if (plan.split_metadata) {
    lines.push(hr());
    lines.push('## Test Splitting Summary\n');
    lines.push(`- **Original test count:** ${plan.split_metadata.original_count}\n`);
    lines.push(`- **Final test count:** ${plan.split_metadata.split_count}\n`);
    lines.push(`- **Tests split:** ${plan.split_metadata.tests_split.length}\n`);

    if (plan.split_metadata.tests_split.length > 0) {
      lines.push('\n### Split Details\n');
      for (const split of plan.split_metadata.tests_split) {
        lines.push(`- **${split.original_id}** split into: ${split.split_into.join(', ')}\n`);
      }
    }
  }

  // Footer
  lines.push(hr());
  lines.push('_Generated by Council Spec Test Council_\n');

  return lines.join('\n');
}

// ============================================================================
// Main
// ============================================================================

const testPlanPath = join(STATE_DIR, 'test-plan-output.json');
if (!existsSync(testPlanPath)) {
  console.error('Error: state/test-plan-output.json not found');
  console.error('Run "npm run test-council" first to generate the test plan');
  process.exit(1);
}

const testPlan: TestPlanOutput = JSON.parse(readFileSync(testPlanPath, 'utf-8'));
const markdown = generateMarkdown(testPlan);

const outputPath = join(STATE_DIR, 'test-plan.md');
writeFileSync(outputPath, markdown);

console.log(`Test plan exported to: state/test-plan.md`);
console.log(`  Total tests: ${testPlan.metadata.total_tests}`);
console.log(`  Size: ${(markdown.length / 1024).toFixed(1)} KB`);
