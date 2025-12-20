import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import type { CouncilOutput } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const STATE_DIR = join(ROOT, 'state');

interface Decision {
  id: string;
  question: string;
  decision: string | number | boolean | string[];
  rationale?: string;
  options_considered?: string[];
}

interface ValidationDecisions {
  decisions: Decision[];
  validated_at?: string;
  validated_by?: string;
}

interface AmbiguityStatus {
  id: string;
  description: string;
  source: string;
  resolved: boolean;
  decision?: Decision;
}

function loadCouncilOutput(): CouncilOutput | null {
  const path = join(STATE_DIR, 'spec-council-output.json');
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function loadDecisions(): ValidationDecisions | null {
  const path = join(STATE_DIR, 'decisions.json');
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    console.error('Error parsing decisions.json:', e);
    return null;
  }
}

function extractOpenQuestions(council: CouncilOutput): Array<{ id: string; question: string; source: string }> {
  const questions: Array<{ id: string; question: string; source: string }> = [];

  // Extract from ambiguities
  for (const amb of council.ambiguities) {
    questions.push({
      id: amb.id,
      question: amb.description,
      source: amb.source,
    });
  }

  // Also look for questions in the synthesis
  const synthesis = council.stage3.synthesis;

  // Look for common question patterns in synthesis
  const questionPatterns = [
    /\*\*([^*]+)\?\*\*/g,  // **Question?**
    /(?:^|\n)\d+\.\s+\*\*([^*]+\?)\*\*/gm,  // 1. **Question?**
    /(?:Critical|Important|Open)[^:]*:\s*([^\n]+\?)/gi,
  ];

  let questionId = questions.length + 1;
  for (const pattern of questionPatterns) {
    let match;
    while ((match = pattern.exec(synthesis)) !== null) {
      const question = match[1].trim();
      // Avoid duplicates
      if (!questions.some(q => q.question.toLowerCase().includes(question.toLowerCase().slice(0, 30)))) {
        questions.push({
          id: `Q-${questionId++}`,
          question,
          source: 'synthesis',
        });
      }
    }
  }

  return questions;
}

function generateTemplate(questions: Array<{ id: string; question: string; source: string }>): ValidationDecisions {
  return {
    decisions: questions.map(q => ({
      id: q.id.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      question: q.question,
      decision: '', // To be filled in
      rationale: '', // Optional
    })),
    validated_at: '', // To be filled in with ISO timestamp
  };
}

function validateDecisions(decisions: ValidationDecisions, questions: Array<{ id: string; question: string }>): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for empty decisions
  for (const d of decisions.decisions) {
    if (!d.decision || (typeof d.decision === 'string' && d.decision.trim() === '')) {
      errors.push(`Decision "${d.id}" has no value`);
    }
    if (!d.question || d.question.trim() === '') {
      warnings.push(`Decision "${d.id}" has no question recorded`);
    }
  }

  // Check for missing timestamp
  if (!decisions.validated_at) {
    warnings.push('No validated_at timestamp set');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// Main execution
const command = process.argv[2] || 'status';

console.log('='.repeat(60));
console.log('SPEC WORKFLOW - Validation Helper');
console.log('='.repeat(60));
console.log('');

// Load council output
const council = loadCouncilOutput();
if (!council) {
  console.error('Error: state/spec-council-output.json not found');
  console.error('Run npm run council first.');
  process.exit(1);
}

// Extract questions/ambiguities
const questions = extractOpenQuestions(council);
const decisions = loadDecisions();

switch (command) {
  case 'status': {
    console.log(`Council completed: ${council.timestamp}`);
    console.log(`Ambiguities found: ${council.ambiguities.length}`);
    console.log(`Open questions extracted: ${questions.length}`);
    console.log('');

    if (decisions) {
      console.log(`Decisions file: Found (${decisions.decisions.length} decisions)`);

      const validation = validateDecisions(decisions, questions);

      if (validation.errors.length > 0) {
        console.log('\nErrors:');
        validation.errors.forEach(e => console.log(`  ✗ ${e}`));
      }

      if (validation.warnings.length > 0) {
        console.log('\nWarnings:');
        validation.warnings.forEach(w => console.log(`  ⚠ ${w}`));
      }

      if (validation.valid) {
        console.log('\n✓ Decisions file is valid');
        console.log('\nNext step: npm run finalize');
      } else {
        console.log('\n✗ Decisions file has errors - please fix before finalizing');
      }
    } else {
      console.log('Decisions file: Not found');
      console.log('\nTo create a template: npm run validate template');
    }
    break;
  }

  case 'template': {
    const template = generateTemplate(questions);
    const templatePath = join(STATE_DIR, 'decisions.json');

    if (existsSync(templatePath)) {
      console.log('Warning: decisions.json already exists');
      console.log('Printing template to stdout instead:\n');
      console.log(JSON.stringify(template, null, 2));
    } else {
      writeFileSync(templatePath, JSON.stringify(template, null, 2));
      console.log(`Template written to state/decisions.json`);
      console.log(`\nFound ${questions.length} questions to resolve:`);
      questions.forEach((q, i) => {
        console.log(`  ${i + 1}. [${q.source}] ${q.question.slice(0, 60)}${q.question.length > 60 ? '...' : ''}`);
      });
      console.log('\nEdit state/decisions.json to fill in decisions, then run:');
      console.log('  npm run validate status');
    }
    break;
  }

  case 'questions': {
    console.log('Open Questions/Ambiguities:\n');
    questions.forEach((q, i) => {
      console.log(`${i + 1}. [${q.source}] ${q.id}`);
      console.log(`   ${q.question}`);
      console.log('');
    });
    break;
  }

  case 'check': {
    if (!decisions) {
      console.error('Error: decisions.json not found');
      console.error('Run: npm run validate template');
      process.exit(1);
    }

    const validation = validateDecisions(decisions, questions);

    console.log('Validation Results:\n');

    if (validation.errors.length > 0) {
      console.log('Errors:');
      validation.errors.forEach(e => console.log(`  ✗ ${e}`));
      console.log('');
    }

    if (validation.warnings.length > 0) {
      console.log('Warnings:');
      validation.warnings.forEach(w => console.log(`  ⚠ ${w}`));
      console.log('');
    }

    if (validation.valid) {
      console.log('✓ All decisions are valid');
      console.log('\nNext step: npm run finalize');
      process.exit(0);
    } else {
      console.log('✗ Validation failed');
      process.exit(1);
    }
  }

  default:
    console.log('Usage: npm run validate [command]');
    console.log('');
    console.log('Commands:');
    console.log('  status    Show validation status (default)');
    console.log('  template  Generate decisions.json template from council output');
    console.log('  questions List all open questions/ambiguities');
    console.log('  check     Validate decisions.json and exit with status code');
}
