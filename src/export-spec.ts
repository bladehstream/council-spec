/**
 * Export Spec - Convert spec-final.json to human-readable markdown
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { SpecFinal } from './types.js';
import {
  formatSection,
  formatBulletList,
  formatNumberedList,
  createTable,
  formatDate,
  priorityBadge,
  hr,
  createTOC,
} from './markdown-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const STATE_DIR = join(ROOT, 'state');

interface ExtendedSpec {
  metadata?: {
    project_name?: string;
    version?: string;
    generated_at?: string;
    interview_completed?: string;
    council_completed?: string;
    council_config?: {
      responders?: string;
      evaluators?: string;
      chairman?: string;
    };
  };
  validated_decisions?: Record<string, { decision: string; rationale?: string }>;
  problem_statement?: {
    summary: string;
    context?: string;
    motivation?: string;
  };
  users_and_actors?: Array<{
    name: string;
    description?: string;
    goals?: string[];
  }>;
  success_criteria?: string[];
  out_of_scope?: string[];
  constraints?: {
    tech_stack?: string[];
    timeline?: string;
    budget?: string;
    compliance?: string[];
  };
  core_functionality?: Array<{
    feature: string;
    description?: string;
    priority: string;
  }>;
  architecture?: string;
  data_model?: string;
  api_contracts?: string;
  user_flows?: string;
  security?: string;
  deployment?: string;
  council_synthesis?: string;
  // Standard SpecFinal fields
  project_id?: string;
  version?: string;
  created_at?: string;
  interview_summary?: string;
  decisions?: Array<{
    ambiguity_id: string;
    decision: string;
    rationale?: string;
  }>;
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
  // Feature traceability
  feature_manifest?: {
    features: Array<{
      id: string;
      name: string;
      description: string;
      priority: string;
      acceptance_criteria?: string[];
      validated_by_tests?: string[];
    }>;
    generated_at: string;
    tests_linked_at?: string;
  };
}

function generateMarkdown(spec: ExtendedSpec): string {
  const lines: string[] = [];

  // Title and metadata
  const projectName = spec.metadata?.project_name || spec.project_id || 'Project';
  const version = spec.metadata?.version || spec.version || '1.0.0';
  const generatedAt = spec.metadata?.generated_at || spec.created_at || new Date().toISOString();

  lines.push(`# ${projectName} - Technical Specification\n`);
  lines.push(`**Version:** ${version}  `);
  lines.push(`**Generated:** ${formatDate(generatedAt)}  \n`);

  // Table of Contents
  lines.push('## Table of Contents\n');
  const tocHeadings = [
    { level: 2, text: 'Overview' },
    { level: 2, text: 'Users and Actors' },
    { level: 2, text: 'Core Functionality' },
    { level: 2, text: 'Architecture' },
    { level: 2, text: 'Data Model' },
    { level: 2, text: 'API Contracts' },
    { level: 2, text: 'User Flows' },
    { level: 2, text: 'Security' },
    { level: 2, text: 'Deployment' },
    { level: 2, text: 'Decisions' },
    { level: 2, text: 'Acceptance Criteria' },
  ];
  lines.push(createTOC(tocHeadings));
  lines.push(hr());

  // Overview / Problem Statement
  lines.push('## Overview\n');
  if (spec.problem_statement) {
    lines.push(spec.problem_statement.summary + '\n');
    if (spec.problem_statement.context) {
      lines.push('\n### Context\n');
      lines.push(spec.problem_statement.context + '\n');
    }
    if (spec.problem_statement.motivation) {
      lines.push('\n### Motivation\n');
      lines.push(spec.problem_statement.motivation + '\n');
    }
  } else if (spec.specification?.overview) {
    lines.push(spec.specification.overview + '\n');
  } else if (spec.interview_summary) {
    lines.push(spec.interview_summary + '\n');
  }
  lines.push('');

  // Constraints
  if (spec.constraints) {
    lines.push('### Constraints\n');
    if (spec.constraints.tech_stack?.length) {
      lines.push('**Tech Stack:**\n');
      lines.push(formatBulletList(spec.constraints.tech_stack));
    }
    if (spec.constraints.timeline) {
      lines.push(`**Timeline:** ${spec.constraints.timeline}\n`);
    }
    if (spec.constraints.compliance?.length) {
      lines.push('**Compliance:**\n');
      lines.push(formatBulletList(spec.constraints.compliance));
    }
    lines.push('');
  }

  // Out of Scope
  if (spec.out_of_scope?.length) {
    lines.push('### Out of Scope\n');
    lines.push(formatBulletList(spec.out_of_scope));
    lines.push('');
  }

  lines.push(hr());

  // Users and Actors
  lines.push('## Users and Actors\n');
  if (spec.users_and_actors?.length) {
    for (const actor of spec.users_and_actors) {
      lines.push(`### ${actor.name}\n`);
      if (actor.description) {
        lines.push(actor.description + '\n');
      }
      if (actor.goals?.length) {
        lines.push('\n**Goals:**\n');
        lines.push(formatBulletList(actor.goals));
      }
      lines.push('');
    }
  } else {
    lines.push('_Not specified_\n');
  }
  lines.push(hr());

  // Core Functionality
  lines.push('## Core Functionality\n');

  // Prefer feature_manifest if available (has test traceability)
  if (spec.feature_manifest?.features?.length) {
    const hasTests = spec.feature_manifest.features.some(f => f.validated_by_tests?.length);
    const headers = hasTests
      ? ['ID', 'Feature', 'Priority', 'Validated By']
      : ['ID', 'Feature', 'Description', 'Priority'];

    const rows = spec.feature_manifest.features.map(f => {
      if (hasTests) {
        const tests = f.validated_by_tests?.length
          ? f.validated_by_tests.join(', ')
          : '_No tests_';
        return [f.id, f.name, priorityBadge(f.priority), tests];
      } else {
        return [f.id, f.name, f.description || '_No description_', priorityBadge(f.priority)];
      }
    });
    lines.push(createTable(headers, rows));

    // Show test coverage summary
    if (spec.feature_manifest.tests_linked_at) {
      const covered = spec.feature_manifest.features.filter(f => f.validated_by_tests?.length).length;
      const total = spec.feature_manifest.features.length;
      const pct = total > 0 ? Math.round((covered / total) * 100) : 0;
      lines.push(`\n**Test Coverage:** ${covered}/${total} features (${pct}%)\n`);
    }
  } else if (spec.core_functionality?.length) {
    const rows = spec.core_functionality.map(f => [
      f.feature,
      f.description || '_No description_',
      priorityBadge(f.priority),
    ]);
    lines.push(createTable(['Feature', 'Description', 'Priority'], rows));
  } else {
    lines.push('_Not specified_\n');
  }
  lines.push(hr());

  // Architecture
  lines.push('## Architecture\n');
  const arch = spec.architecture || spec.specification?.architecture;
  if (arch && arch !== 'See council synthesis') {
    lines.push(arch + '\n');
  } else {
    lines.push('_See council synthesis for architecture details_\n');
  }
  lines.push(hr());

  // Data Model
  lines.push('## Data Model\n');
  const dataModel = spec.data_model || spec.specification?.data_model;
  if (dataModel && dataModel !== 'See council synthesis') {
    lines.push(dataModel + '\n');
  } else {
    lines.push('_See council synthesis for data model details_\n');
  }
  lines.push(hr());

  // API Contracts
  lines.push('## API Contracts\n');
  const api = spec.api_contracts || spec.specification?.api_contracts;
  if (api && api !== 'See council synthesis') {
    lines.push(api + '\n');
  } else {
    lines.push('_See council synthesis for API contract details_\n');
  }
  lines.push(hr());

  // User Flows
  lines.push('## User Flows\n');
  const flows = spec.user_flows || spec.specification?.user_flows;
  if (flows && flows !== 'See council synthesis') {
    lines.push(flows + '\n');
  } else {
    lines.push('_See council synthesis for user flow details_\n');
  }
  lines.push(hr());

  // Security
  lines.push('## Security\n');
  const security = spec.security || spec.specification?.security;
  if (security && security !== 'See council synthesis') {
    lines.push(security + '\n');
  } else {
    lines.push('_See council synthesis for security details_\n');
  }
  lines.push(hr());

  // Deployment
  lines.push('## Deployment\n');
  const deployment = spec.deployment || spec.specification?.deployment;
  if (deployment && deployment !== 'See council synthesis') {
    lines.push(deployment + '\n');
  } else {
    lines.push('_See council synthesis for deployment details_\n');
  }
  lines.push(hr());

  // Decisions
  lines.push('## Decisions\n');
  if (spec.validated_decisions && Object.keys(spec.validated_decisions).length > 0) {
    for (const [id, decision] of Object.entries(spec.validated_decisions)) {
      lines.push(`### ${id}\n`);
      lines.push(`**Decision:** ${decision.decision}\n`);
      if (decision.rationale) {
        lines.push(`\n**Rationale:** ${decision.rationale}\n`);
      }
      lines.push('');
    }
  } else if (spec.decisions?.length) {
    for (const decision of spec.decisions) {
      lines.push(`### ${decision.ambiguity_id}\n`);
      lines.push(`**Decision:** ${decision.decision}\n`);
      if (decision.rationale) {
        lines.push(`\n**Rationale:** ${decision.rationale}\n`);
      }
      lines.push('');
    }
  } else {
    lines.push('_No decisions recorded_\n');
  }
  lines.push(hr());

  // Acceptance Criteria
  lines.push('## Acceptance Criteria\n');
  const criteria = spec.success_criteria || spec.specification?.acceptance_criteria;
  if (criteria?.length) {
    lines.push(formatNumberedList(criteria));
  } else {
    lines.push('_Not specified_\n');
  }
  lines.push('');

  // Footer
  lines.push(hr());
  lines.push('_Generated by Council Spec_\n');

  return lines.join('\n');
}

// Main execution
const specPath = join(STATE_DIR, 'spec-final.json');
if (!existsSync(specPath)) {
  console.error('Error: state/spec-final.json not found');
  console.error('Run "npm run finalize" first to generate the specification');
  process.exit(1);
}

const spec: ExtendedSpec = JSON.parse(readFileSync(specPath, 'utf-8'));
const markdown = generateMarkdown(spec);

const outputPath = join(STATE_DIR, 'spec-final.md');
writeFileSync(outputPath, markdown);

console.log(`Specification exported to: state/spec-final.md`);
console.log(`  Size: ${(markdown.length / 1024).toFixed(1)} KB`);
