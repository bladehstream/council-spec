import { readFileSync, writeFileSync, existsSync, appendFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import type { InterviewOutput, CouncilOutput, SpecFinal, Config, FeatureManifest, FeatureManifestEntry, FeaturesPhaseOutput } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const STATE_DIR = join(ROOT, 'state');

interface ValidationDecisions {
  decisions: Array<{
    id: string;
    question: string;
    decision: string;
    rationale?: string;
  }>;
  validated_at?: string;
}

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

function loadJson<T>(filename: string, required = true): T | null {
  const path = join(STATE_DIR, filename);
  if (!existsSync(path)) {
    if (required) {
      console.error(`Error: state/${filename} not found`);
      process.exit(1);
    }
    return null;
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function loadConfig(): Config {
  return JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf-8'));
}

function loadPreferences(): Record<string, string> | null {
  const path = join(STATE_DIR, 'council-preferences.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function extractProjectId(): string {
  // Try to extract from conversation log filename
  const convDir = join(ROOT, 'state', 'conversations');
  if (existsSync(convDir)) {
    const files = readdirSync(convDir)
      .filter(f => f.endsWith('.log'))
      .sort()
      .reverse();

    if (files[0]) {
      // Format: YYYY-MM-DD_HHMMSS_<project-id>.log
      const match = files[0].match(/^\d{4}-\d{2}-\d{2}_\d{6}_(.+)\.log$/);
      if (match) {
        return match[1];
      }
    }
  }

  // Fallback to timestamp-based ID
  return `spec-${Date.now()}`;
}

// ============================================================================
// Feature ID Assignment and Manifest Building
// ============================================================================

interface CoreFunctionalityItem {
  id?: string;
  feature: string;
  description?: string;
  priority: 'must_have' | 'should_have' | 'nice_to_have';
}

/**
 * Assigns stable feature IDs (FEAT-001, FEAT-002, etc.) to features.
 * Preserves existing IDs if they match the expected pattern.
 */
function assignFeatureIds(features: CoreFunctionalityItem[]): Array<CoreFunctionalityItem & { id: string }> {
  let nextId = 1;
  return features.map(f => {
    // If feature already has a valid ID, keep it
    if (f.id && /^FEAT-\d{3}$/.test(f.id)) {
      // Update nextId to avoid conflicts
      const existingNum = parseInt(f.id.split('-')[1], 10);
      if (existingNum >= nextId) {
        nextId = existingNum + 1;
      }
      return f as CoreFunctionalityItem & { id: string };
    }
    // Assign a new ID
    const id = `FEAT-${String(nextId++).padStart(3, '0')}`;
    return { ...f, id };
  });
}

/**
 * Builds a feature manifest from interview data or phased workflow output.
 * Prefers phase-features-output.json if it exists (richer data).
 */
function buildFeatureManifest(interview: InterviewOutput): FeatureManifest {
  // Check for phased workflow output first
  const phaseFeaturesPath = join(STATE_DIR, 'phase-features-output.json');
  if (existsSync(phaseFeaturesPath)) {
    try {
      const phaseFeatures = JSON.parse(readFileSync(phaseFeaturesPath, 'utf-8')) as FeaturesPhaseOutput;
      if (phaseFeatures.features?.length > 0) {
        console.log('  Using feature IDs from phase-features-output.json');
        return {
          features: phaseFeatures.features.map(f => ({
            id: f.id,
            name: f.name,
            description: f.description,
            priority: f.priority,
            acceptance_criteria: f.acceptance_criteria,
          })),
          generated_at: new Date().toISOString(),
        };
      }
    } catch (e) {
      console.warn('  Warning: Could not parse phase-features-output.json, falling back to interview');
    }
  }

  // Fall back to interview core_functionality
  const featuresWithIds = assignFeatureIds(interview.core_functionality);
  console.log(`  Assigned ${featuresWithIds.length} feature IDs from interview`);

  return {
    features: featuresWithIds.map(f => ({
      id: f.id,
      name: f.feature,
      description: f.description || '',
      priority: f.priority,
    })),
    generated_at: new Date().toISOString(),
  };
}

// ============================================================================
// Specification Compilation
// ============================================================================

function compileSpecification(
  interview: InterviewOutput,
  council: CouncilOutput,
  decisions: ValidationDecisions | null
): SpecFinal {
  const config = loadConfig();
  const preferences = loadPreferences();

  // Extract spec sections from council synthesis or use defaults
  const specSections = council.spec_sections || {};

  // Build feature manifest with stable IDs
  const featureManifest = buildFeatureManifest(interview);

  // Build the final specification
  const spec: SpecFinal = {
    project_id: extractProjectId(),
    version: '1.0.0',
    created_at: new Date().toISOString(),
    interview_summary: interview.problem_statement.summary,
    decisions: decisions?.decisions.map(d => ({
      ambiguity_id: d.id,
      decision: d.decision,
      rationale: d.rationale,
    })) || [],
    specification: {
      overview: interview.problem_statement.summary +
        (interview.problem_statement.context ? `\n\n${interview.problem_statement.context}` : '') +
        (interview.problem_statement.motivation ? `\n\nMotivation: ${interview.problem_statement.motivation}` : ''),
      architecture: specSections.architecture || 'See council synthesis',
      data_model: specSections.data_model || 'See council synthesis',
      api_contracts: specSections.api_contracts || 'See council synthesis',
      user_flows: specSections.user_flows || 'See council synthesis',
      security: specSections.security || 'See council synthesis',
      deployment: specSections.deployment || 'See council synthesis',
      acceptance_criteria: interview.success_criteria || [],
    },
    feature_manifest: featureManifest,
  };

  return spec;
}

function compileExtendedSpec(
  interview: InterviewOutput,
  council: CouncilOutput,
  decisions: ValidationDecisions | null
): Record<string, unknown> {
  const config = loadConfig();
  const preferences = loadPreferences();

  // Build feature manifest with stable IDs
  const featureManifest = buildFeatureManifest(interview);

  // Build an extended specification that preserves more detail
  return {
    metadata: {
      project_name: (interview as any).project_name || extractProjectId(),
      version: '1.0.0',
      generated_at: new Date().toISOString(),
      interview_completed: (interview as any).interview_completed,
      council_completed: council.timestamp,
      council_config: {
        responders: preferences?.responders || config.council.responders,
        evaluators: preferences?.evaluators || config.council.evaluators,
        chairman: preferences?.chairman || config.council.chairman,
      },
    },

    // Validated decisions from human review
    validated_decisions: decisions?.decisions.reduce((acc, d) => {
      acc[d.id] = {
        decision: d.decision,
        rationale: d.rationale,
      };
      return acc;
    }, {} as Record<string, { decision: string; rationale?: string }>) || {},

    // Carry forward from interview
    problem_statement: interview.problem_statement,
    users_and_actors: interview.users_and_actors,
    success_criteria: interview.success_criteria,
    out_of_scope: interview.out_of_scope,
    constraints: interview.constraints,

    // Enhanced core functionality (may be updated during validation)
    core_functionality: interview.core_functionality,

    // Council-synthesized sections
    architecture: council.spec_sections?.architecture ?
      parseMarkdownToStructure(council.spec_sections.architecture) : null,
    data_model: council.spec_sections?.data_model ?
      parseMarkdownToStructure(council.spec_sections.data_model) : null,
    api_contracts: council.spec_sections?.api_contracts ?
      parseMarkdownToStructure(council.spec_sections.api_contracts) : null,
    user_flows: council.spec_sections?.user_flows ?
      parseMarkdownToStructure(council.spec_sections.user_flows) : null,
    security: council.spec_sections?.security ?
      parseMarkdownToStructure(council.spec_sections.security) : null,
    deployment: council.spec_sections?.deployment ?
      parseMarkdownToStructure(council.spec_sections.deployment) : null,

    // If council didn't extract sections, include the full synthesis
    council_synthesis: !council.spec_sections?.architecture ?
      council.stage3.synthesis : undefined,

    // Feature manifest with stable IDs for traceability
    feature_manifest: featureManifest,
  };
}

function parseMarkdownToStructure(markdown: string): string {
  // For now, just return the markdown as-is
  // Could be enhanced to parse into structured data
  return markdown;
}

// Main execution
console.log('='.repeat(60));
console.log('SPEC WORKFLOW - Finalize Phase');
console.log('='.repeat(60));
console.log('');

// Load required files
const interview = loadJson<InterviewOutput>('interview-output.json')!;
const council = loadJson<CouncilOutput>('spec-council-output.json')!
const decisions = loadJson<ValidationDecisions>('decisions.json', false);

// Verify council was run on the current interview
const { createHash } = await import('crypto');
const currentHash = createHash('sha256')
  .update(JSON.stringify(interview))
  .digest('hex')
  .substring(0, 12);

if (council.input_hash !== currentHash) {
  console.warn('Warning: Council output may be stale (interview hash mismatch)');
  console.warn(`  Interview hash: ${currentHash}`);
  console.warn(`  Council input hash: ${council.input_hash}`);
  console.warn('');
}

// Check for unresolved ambiguities
const unresolvedAmbiguities = council.ambiguities.filter(a => !a.resolution);
if (unresolvedAmbiguities.length > 0 && !decisions) {
  console.warn(`Warning: ${unresolvedAmbiguities.length} ambiguities have no resolution`);
  console.warn('Consider creating state/decisions.json with validation decisions');
  console.warn('');
}

// Compile the specification
console.log('Compiling final specification...');

// Use extended format if interview has extra fields, otherwise use standard SpecFinal
const hasExtendedFields = (interview as any).project_name || (interview as any)._extended_details;
let output: Record<string, unknown>;

if (hasExtendedFields) {
  output = compileExtendedSpec(interview, council, decisions);
  console.log('Using extended specification format');
} else {
  output = compileSpecification(interview, council, decisions) as unknown as Record<string, unknown>;
  console.log('Using standard specification format');
}

// Write output
const outputPath = join(STATE_DIR, 'spec-final.json');
writeFileSync(outputPath, JSON.stringify(output, null, 2));

// Extract feature count from output
const featureCount = (output as any).feature_manifest?.features?.length || 0;

log(`
--- PHASE: COMPLETE ---
[${new Date().toISOString()}]

Final spec written to state/spec-final.json
Interview hash: ${currentHash}
Decisions included: ${decisions?.decisions.length || 0}
Format: ${hasExtendedFields ? 'extended' : 'standard'}
Features with IDs: ${featureCount}
`);

console.log('');
console.log('Final specification written to state/spec-final.json');
console.log(`  Interview hash: ${currentHash}`);
console.log(`  Decisions: ${decisions?.decisions.length || 0}`);
console.log(`  Format: ${hasExtendedFields ? 'extended' : 'standard'}`);
console.log(`  Features: ${featureCount} (with stable IDs)`);
