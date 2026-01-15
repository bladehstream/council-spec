/**
 * Phase Orchestrator for Feature/Architecture Split Workflow
 *
 * This module implements the phased workflow:
 * 1. Features Phase: Gather feature requirements only (no architecture)
 * 2. Architecture Phase: Design architecture to support features
 * 3. Spec Phase: Synthesize detailed specification
 * 4. Tests Phase: Generate test plan (uses existing test-council)
 * 5. All Phase: Run integrated workflow (backward compatible)
 *
 * Usage:
 *   npm run phase -- --phase features --output features.json
 *   npm run phase -- --phase architecture --input features.json --output architecture.json
 *   npm run phase -- --phase spec --input features.json --input architecture.json
 *   npm run phase -- --phase all --critique
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
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
  runCritiquePhase,
  runCritiqueResolve,
  type PipelineResult,
  type EnhancedPipelineConfig,
  type CheckpointOptions,
  type AgentConfig,
  type TwoPassConfig,
  type Stage1Result,
  type CritiqueConfig,
  type CritiqueItem,
  type CritiqueResult,
} from 'agent-council';
import type {
  InterviewOutput,
  Config,
  ExtendedConfig,
  PhaseName,
  PhaseCliOptions,
  PhaseResult,
  FeaturesPhaseOutput,
  ArchitecturePhaseOutput,
  AdvisoryConcern,
  Ambiguity,
} from './types.js';
import {
  buildFeaturesPrompt,
  buildArchitecturePrompt,
  buildSpecFromPhasesPrompt,
  buildFeaturesCritiquePrompt,
  buildArchitectureCritiquePrompt,
} from './phase-prompts.js';
import { smartParseChairmanOutput, sectionsToMap } from './json-parser.js';
import { runTestCouncil } from './test-council.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const STATE_DIR = join(ROOT, 'state');

// ============================================================================
// CLI Argument Parsing
// ============================================================================

interface ParsedArgs extends PhaseCliOptions {
  help?: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    phase: 'all',
    input: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--phase') {
      const value = args[++i];
      if (!['features', 'architecture', 'spec', 'tests', 'all'].includes(value)) {
        throw new Error(`Invalid phase: ${value}. Must be one of: features, architecture, spec, tests, all`);
      }
      result.phase = value as PhaseName;
    } else if (arg === '--input') {
      const value = args[++i];
      if (!value) throw new Error('--input requires a file path');
      result.input = result.input || [];
      result.input.push(value);
    } else if (arg === '--output') {
      result.output = args[++i];
      if (!result.output) throw new Error('--output requires a file path');
    } else if (arg === '--critique') {
      result.critique = true;
    } else if (arg === '--confirm') {
      result.confirm = true;
    }
  }

  // Validation
  if (result.confirm && !result.critique) {
    throw new Error('--confirm requires --critique to be enabled');
  }

  return result;
}

function printHelp(): void {
  console.log(`
Usage: npm run phase -- [options]

Options:
  --phase <name>     Phase to run: features, architecture, spec, tests, all
                     Default: all (integrated workflow)

  --input <file>     Input file from previous phase (can be specified multiple times)
                     - architecture phase requires features input
                     - spec phase requires features and architecture inputs
                     - tests phase reads from state/spec-final.json (no input required)

  --output <file>    Output file path for this phase's artifact
                     Default: state/phase-<name>-output.json

  --critique         Enable critique loop for this phase
                     Runs adversarial review after initial generation

  --confirm          Enable human confirmation for critique decisions
                     Pauses before applying blocking critiques (requires --critique)

Examples:
  # Run features phase only
  npm run phase -- --phase features --output state/features.json

  # Run architecture phase with critique
  npm run phase -- --phase architecture --input state/features.json --critique --confirm

  # Run spec phase from split inputs
  npm run phase -- --phase spec --input state/features.json --input state/architecture.json

  # Run tests phase (requires spec-final.json from finalize)
  npm run phase -- --phase tests

  # Run full integrated workflow (backward compatible)
  npm run phase -- --phase all
`);
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
// Configuration
// ============================================================================

function loadConfig(): ExtendedConfig {
  return JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf-8'));
}

function loadInterview(): InterviewOutput {
  const path = join(STATE_DIR, 'interview-output.json');
  if (!existsSync(path)) {
    console.error('Error: state/interview-output.json not found');
    console.error('Complete the interview phase first.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function hashObject(obj: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(obj))
    .digest('hex')
    .substring(0, 12);
}

function getEffectivePhaseConfig(config: ExtendedConfig, phase: PhaseName, options: ParsedArgs) {
  const phaseConfig = config.phases?.[phase as keyof NonNullable<ExtendedConfig['phases']>];
  const presetName = process.env.COUNCIL_PRESET || 'merge-balanced';
  const modelsConfig = loadModelsConfig();
  const preset = getPreset(presetName, modelsConfig);

  return {
    responders: process.env.COUNCIL_RESPONDERS || phaseConfig?.responders || `${preset.stage1.count}:${preset.stage1.tier}`,
    chairman: process.env.COUNCIL_CHAIRMAN || phaseConfig?.chairman || 'gemini:heavy',
    critique: options.critique ?? phaseConfig?.critique ?? false,
    confirm: options.confirm ?? phaseConfig?.confirm ?? false,
    preset,
    presetName,
  };
}

// ============================================================================
// Phase Runners
// ============================================================================

/**
 * Run the features phase: extract features from interview.
 */
async function runFeaturesPhase(
  interview: InterviewOutput,
  config: ExtendedConfig,
  options: ParsedArgs
): Promise<PhaseResult> {
  const startTime = Date.now();
  const phaseConfig = getEffectivePhaseConfig(config, 'features', options);

  console.log('\n' + '='.repeat(60));
  console.log('PHASE: FEATURES');
  console.log('='.repeat(60));
  console.log('Focus: WHAT the system does (no architecture)');
  console.log(`Responders: ${phaseConfig.responders}`);
  console.log(`Chairman: ${phaseConfig.chairman}`);
  console.log(`Critique: ${phaseConfig.critique ? 'enabled' : 'disabled'}`);
  if (phaseConfig.confirm) console.log('Confirm: enabled');
  console.log('');

  log(`
--- PHASE: FEATURES ---
[${new Date().toISOString()}]
Config: responders=${phaseConfig.responders}, chairman=${phaseConfig.chairman}, critique=${phaseConfig.critique}
`);

  try {
    const modelsConfig = loadModelsConfig();
    const availableProviders = listProviders(modelsConfig);

    // Build pipeline config
    const stage1Spec = parseStageSpec(phaseConfig.responders, availableProviders, modelsConfig);
    const chairman = createAgentFromSpec(phaseConfig.chairman);

    const pipelineConfig: EnhancedPipelineConfig = {
      mode: 'merge',
      stage1: { agents: stage1Spec.agents },
      stage3: {
        chairman,
        useReasoning: false,
        useSummaries: true,
        twoPass: {
          enabled: true,
          pass1Tier: 'heavy' as const,
          pass2Tier: 'default' as const,
        },
      },
      // Add critique config if enabled
      critique: phaseConfig.critique ? {
        enabled: true,
        confirm: phaseConfig.confirm,
      } : undefined,
    };

    const prompt = buildFeaturesPrompt(interview);

    // If user explicitly requests --confirm, trust they want interactive prompts
    // even if stdout isn't detected as TTY (e.g., running through Claude Code)
    const result = await runEnhancedPipeline(prompt, {
      config: pipelineConfig,
      timeoutMs: config.council.timeout_seconds * 1000,
      tty: phaseConfig.confirm ? true : (process.stdout.isTTY ?? false),
      silent: false,
    });

    if (!result) {
      throw new Error('Features phase pipeline returned no results');
    }

    // Parse the output
    const output = parseFeaturesPipelineOutput(result, interview, phaseConfig.presetName);

    // Determine output path first (needed for critique logging)
    const outputPath = options.output || join(STATE_DIR, 'phase-features-output.json');

    // Handle critique results
    if (result.critiqueResult) {
      output.advisory = extractAdvisoryConcerns(result.critiqueResult);

      // Write full critique log (blocking applied/rejected + advisory)
      const critiquePath = outputPath.replace('.json', '.critiques.md');
      writeCritiqueLog(critiquePath, 'features', result.critiqueResult);
      console.log(`\nCritique results logged to: ${critiquePath}`);
    }

    // Write output
    writeFileSync(outputPath, JSON.stringify(output, null, 2));

    // Write advisory log if any (kept for backward compatibility)
    if (output.advisory && output.advisory.length > 0) {
      const advisoryPath = outputPath.replace('.json', '.advisory.md');
      writeAdvisoryLog(advisoryPath, 'features', output.advisory);
      console.log(`Advisory concerns logged to: ${advisoryPath}`);
    }

    log(`Features phase complete. Output: ${outputPath}`);

    console.log('\n' + '='.repeat(60));
    console.log('Features Phase Complete');
    console.log('='.repeat(60));
    console.log(`Features: ${output.features.length}`);
    console.log(`Users: ${output.users.length}`);
    console.log(`Ambiguities: ${output.ambiguities.length}`);
    console.log(`Output: ${outputPath}`);

    return {
      phase: 'features',
      success: true,
      output_file: outputPath,
      advisory_file: output.advisory?.length ? outputPath.replace('.json', '.advisory.md') : undefined,
      duration_ms: Date.now() - startTime,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Features phase FAILED: ${errorMessage}`);
    console.error('Features phase failed:', errorMessage);

    return {
      phase: 'features',
      success: false,
      error: errorMessage,
      duration_ms: Date.now() - startTime,
    };
  }
}

/**
 * Run the architecture phase: design architecture based on features.
 */
async function runArchitecturePhase(
  features: FeaturesPhaseOutput,
  interview: InterviewOutput,
  config: ExtendedConfig,
  options: ParsedArgs
): Promise<PhaseResult> {
  const startTime = Date.now();
  const phaseConfig = getEffectivePhaseConfig(config, 'architecture', options);

  console.log('\n' + '='.repeat(60));
  console.log('PHASE: ARCHITECTURE');
  console.log('='.repeat(60));
  console.log('Focus: HOW to implement features');
  console.log(`Features input: ${features.features.length} features`);
  console.log(`Responders: ${phaseConfig.responders}`);
  console.log(`Chairman: ${phaseConfig.chairman}`);
  console.log(`Critique: ${phaseConfig.critique ? 'enabled' : 'disabled'}`);
  if (phaseConfig.confirm) console.log('Confirm: enabled');
  console.log('');

  log(`
--- PHASE: ARCHITECTURE ---
[${new Date().toISOString()}]
Config: responders=${phaseConfig.responders}, chairman=${phaseConfig.chairman}, critique=${phaseConfig.critique}
Features hash: ${features.metadata.interview_hash}
`);

  try {
    const modelsConfig = loadModelsConfig();
    const availableProviders = listProviders(modelsConfig);

    // Build pipeline config
    const stage1Spec = parseStageSpec(phaseConfig.responders, availableProviders, modelsConfig);
    const chairman = createAgentFromSpec(phaseConfig.chairman);

    const pipelineConfig: EnhancedPipelineConfig = {
      mode: 'merge',
      stage1: { agents: stage1Spec.agents },
      stage3: {
        chairman,
        useReasoning: false,
        useSummaries: true,
        twoPass: {
          enabled: true,
          pass1Tier: 'heavy' as const,
          pass2Tier: 'default' as const,
        },
      },
      critique: phaseConfig.critique ? {
        enabled: true,
        confirm: phaseConfig.confirm,
      } : undefined,
    };

    const prompt = buildArchitecturePrompt(features, interview);

    // If user explicitly requests --confirm, trust they want interactive prompts
    // even if stdout isn't detected as TTY (e.g., running through Claude Code)
    const result = await runEnhancedPipeline(prompt, {
      config: pipelineConfig,
      timeoutMs: config.council.timeout_seconds * 1000,
      tty: phaseConfig.confirm ? true : (process.stdout.isTTY ?? false),
      silent: false,
    });

    if (!result) {
      throw new Error('Architecture phase pipeline returned no results');
    }

    // Parse the output
    const output = parseArchitecturePipelineOutput(result, features, phaseConfig.presetName);

    // Determine output path first (needed for critique logging)
    const outputPath = options.output || join(STATE_DIR, 'phase-architecture-output.json');

    // Handle critique results
    if (result.critiqueResult) {
      output.advisory = extractAdvisoryConcerns(result.critiqueResult);

      // Write full critique log (blocking applied/rejected + advisory)
      const critiquePath = outputPath.replace('.json', '.critiques.md');
      writeCritiqueLog(critiquePath, 'architecture', result.critiqueResult);
      console.log(`\nCritique results logged to: ${critiquePath}`);
    }

    // Write output
    writeFileSync(outputPath, JSON.stringify(output, null, 2));

    // Write advisory log if any (kept for backward compatibility)
    if (output.advisory && output.advisory.length > 0) {
      const advisoryPath = outputPath.replace('.json', '.advisory.md');
      writeAdvisoryLog(advisoryPath, 'architecture', output.advisory);
      console.log(`\nAdvisory concerns logged to: ${advisoryPath}`);
    }

    log(`Architecture phase complete. Output: ${outputPath}`);

    console.log('\n' + '='.repeat(60));
    console.log('Architecture Phase Complete');
    console.log('='.repeat(60));
    console.log(`Components: ${output.architecture.components.length}`);
    console.log(`Entities: ${output.data_model.entities.length}`);
    console.log(`Endpoints: ${output.api_contracts.endpoints.length}`);
    console.log(`Technology decisions: ${output.technology_decisions.length}`);
    console.log(`Ambiguities: ${output.ambiguities.length}`);
    console.log(`Output: ${outputPath}`);

    return {
      phase: 'architecture',
      success: true,
      output_file: outputPath,
      advisory_file: output.advisory?.length ? outputPath.replace('.json', '.advisory.md') : undefined,
      duration_ms: Date.now() - startTime,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Architecture phase FAILED: ${errorMessage}`);
    console.error('Architecture phase failed:', errorMessage);

    return {
      phase: 'architecture',
      success: false,
      error: errorMessage,
      duration_ms: Date.now() - startTime,
    };
  }
}

/**
 * Run the spec phase from split inputs (features + architecture).
 */
async function runSpecPhase(
  features: FeaturesPhaseOutput,
  architecture: ArchitecturePhaseOutput,
  interview: InterviewOutput,
  config: ExtendedConfig,
  options: ParsedArgs
): Promise<PhaseResult> {
  const startTime = Date.now();
  const phaseConfig = getEffectivePhaseConfig(config, 'spec', options);

  console.log('\n' + '='.repeat(60));
  console.log('PHASE: SPECIFICATION');
  console.log('='.repeat(60));
  console.log('Synthesizing from features and architecture');
  console.log(`Features: ${features.features.length}`);
  console.log(`Components: ${architecture.architecture.components.length}`);
  console.log(`Responders: ${phaseConfig.responders}`);
  console.log(`Chairman: ${phaseConfig.chairman}`);
  console.log('');

  log(`
--- PHASE: SPEC (from split inputs) ---
[${new Date().toISOString()}]
Features hash: ${features.metadata.interview_hash}
Architecture hash: ${architecture.metadata.features_hash}
`);

  try {
    const modelsConfig = loadModelsConfig();
    const availableProviders = listProviders(modelsConfig);

    const stage1Spec = parseStageSpec(phaseConfig.responders, availableProviders, modelsConfig);
    const chairman = createAgentFromSpec(phaseConfig.chairman);

    const pipelineConfig: EnhancedPipelineConfig = {
      mode: 'merge',
      stage1: { agents: stage1Spec.agents },
      stage3: {
        chairman,
        useReasoning: false,
        useSummaries: true,
        twoPass: {
          enabled: true,
          pass1Tier: 'heavy' as const,
          pass2Tier: 'default' as const,
        },
      },
      critique: phaseConfig.critique ? {
        enabled: true,
        confirm: phaseConfig.confirm,
      } : undefined,
    };

    const prompt = buildSpecFromPhasesPrompt(features, architecture, interview);

    // If user explicitly requests --confirm, trust they want interactive prompts
    // even if stdout isn't detected as TTY (e.g., running through Claude Code)
    const result = await runEnhancedPipeline(prompt, {
      config: pipelineConfig,
      timeoutMs: config.council.timeout_seconds * 1000,
      tty: phaseConfig.confirm ? true : (process.stdout.isTTY ?? false),
      silent: false,
    });

    if (!result) {
      throw new Error('Spec phase pipeline returned no results');
    }

    // Parse and structure the output (reuse existing spec-council-output format)
    const sections = parseSectionedOutput(result.stage3.response);
    const sectionMap = new Map(sections.map(s => [s.name, s]));

    // Build output compatible with existing spec-council-output.json format
    const specOutput = {
      input_hash: hashObject({ features, architecture }),
      timestamp: new Date().toISOString(),
      mode: 'merge' as const,
      stage1: result.stage1.map(s => ({ agent: s.agent, response: s.response })),
      stage2: null,
      stage3: {
        chairman: result.stage3.agent,
        synthesis: result.stage3.response,
      },
      ambiguities: parseAmbiguitiesFromSection(sectionMap.get('ambiguities')?.content || ''),
      spec_sections: {
        architecture: sectionMap.get('architecture')?.content || '',
        data_model: sectionMap.get('data_model')?.content || '',
        api_contracts: sectionMap.get('api_contracts')?.content || '',
        user_flows: sectionMap.get('user_flows')?.content || '',
        security: sectionMap.get('security')?.content || '',
        deployment: sectionMap.get('deployment')?.content || '',
      },
      _structured: {
        executive_summary: sectionMap.get('executive_summary')?.content || '',
        traceability: sectionMap.get('traceability')?.content || '',
      },
      // Track that this came from phased workflow
      _phased: {
        features_hash: features.metadata.interview_hash,
        architecture_hash: architecture.metadata.features_hash,
      },
    };

    const outputPath = options.output || join(STATE_DIR, 'spec-council-output.json');
    writeFileSync(outputPath, JSON.stringify(specOutput, null, 2));

    log(`Spec phase complete. Output: ${outputPath}`);

    console.log('\n' + '='.repeat(60));
    console.log('Spec Phase Complete');
    console.log('='.repeat(60));
    console.log(`Sections: ${Object.keys(specOutput.spec_sections).length}`);
    console.log(`Ambiguities: ${specOutput.ambiguities.length}`);
    console.log(`Output: ${outputPath}`);

    return {
      phase: 'spec',
      success: true,
      output_file: outputPath,
      duration_ms: Date.now() - startTime,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Spec phase FAILED: ${errorMessage}`);
    console.error('Spec phase failed:', errorMessage);

    return {
      phase: 'spec',
      success: false,
      error: errorMessage,
      duration_ms: Date.now() - startTime,
    };
  }
}

/**
 * Run the tests phase: generate comprehensive test plan from spec-final.json.
 * This calls the test-council module directly instead of printing instructions.
 */
async function runTestsPhase(
  config: ExtendedConfig,
  options: ParsedArgs
): Promise<PhaseResult> {
  const startTime = Date.now();
  const phaseConfig = getEffectivePhaseConfig(config, 'tests', options);

  console.log('\n' + '='.repeat(60));
  console.log('PHASE: TESTS');
  console.log('='.repeat(60));
  console.log('Generating comprehensive test plan from spec-final.json');
  console.log(`Preset: ${phaseConfig.presetName}`);
  console.log(`Responders: ${phaseConfig.responders}`);
  console.log(`Chairman: ${phaseConfig.chairman}`);
  console.log('');

  log(`
--- PHASE: TESTS ---
[${new Date().toISOString()}]
Config: preset=${phaseConfig.presetName}, responders=${phaseConfig.responders}, chairman=${phaseConfig.chairman}
`);

  try {
    // Call test-council programmatically
    const testResult = await runTestCouncil({
      preset: phaseConfig.presetName,
      responders: phaseConfig.responders,
      chairman: phaseConfig.chairman,
      fromPhase: true,
      tty: phaseConfig.confirm ? true : (process.stdout.isTTY ?? false),
    });

    if (!testResult.success) {
      log(`Tests phase FAILED: ${testResult.error}`);
      return {
        phase: 'tests',
        success: false,
        error: testResult.error,
        duration_ms: Date.now() - startTime,
      };
    }

    log(`Tests phase complete. Output: ${testResult.outputPath}`);

    console.log('\n' + '='.repeat(60));
    console.log('Tests Phase Complete');
    console.log('='.repeat(60));
    console.log(`Total tests: ${testResult.totalTests}`);
    console.log(`Output: ${testResult.outputPath}`);
    console.log(`Duration: ${((testResult.durationMs || 0) / 1000).toFixed(1)}s`);

    return {
      phase: 'tests',
      success: true,
      output_file: testResult.outputPath,
      duration_ms: Date.now() - startTime,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Tests phase FAILED: ${errorMessage}`);
    console.error('Tests phase failed:', errorMessage);

    return {
      phase: 'tests',
      success: false,
      error: errorMessage,
      duration_ms: Date.now() - startTime,
    };
  }
}

/**
 * Run all phases sequentially (backward compatible integrated workflow).
 */
async function runAllPhases(
  interview: InterviewOutput,
  config: ExtendedConfig,
  options: ParsedArgs
): Promise<PhaseResult> {
  console.log('\n' + '='.repeat(60));
  console.log('INTEGRATED PHASED WORKFLOW');
  console.log('='.repeat(60));
  console.log('Running: Features → Architecture → Spec');
  console.log('');

  const startTime = Date.now();

  // Phase 1: Features
  const featuresResult = await runFeaturesPhase(interview, config, options);
  if (!featuresResult.success) {
    return {
      phase: 'all',
      success: false,
      error: `Features phase failed: ${featuresResult.error}`,
      duration_ms: Date.now() - startTime,
    };
  }

  // Load features output
  const features: FeaturesPhaseOutput = JSON.parse(
    readFileSync(featuresResult.output_file!, 'utf-8')
  );

  // Phase 2: Architecture
  const archOptions = { ...options };
  archOptions.output = join(STATE_DIR, 'phase-architecture-output.json');
  const archResult = await runArchitecturePhase(features, interview, config, archOptions);
  if (!archResult.success) {
    return {
      phase: 'all',
      success: false,
      error: `Architecture phase failed: ${archResult.error}`,
      duration_ms: Date.now() - startTime,
    };
  }

  // Load architecture output
  const architecture: ArchitecturePhaseOutput = JSON.parse(
    readFileSync(archResult.output_file!, 'utf-8')
  );

  // Phase 3: Spec
  const specOptions = { ...options };
  specOptions.output = options.output || join(STATE_DIR, 'spec-council-output.json');
  const specResult = await runSpecPhase(features, architecture, interview, config, specOptions);
  if (!specResult.success) {
    return {
      phase: 'all',
      success: false,
      error: `Spec phase failed: ${specResult.error}`,
      duration_ms: Date.now() - startTime,
    };
  }

  console.log('\n' + '='.repeat(60));
  console.log('INTEGRATED WORKFLOW COMPLETE');
  console.log('='.repeat(60));
  console.log(`Features: ${featuresResult.output_file}`);
  console.log(`Architecture: ${archResult.output_file}`);
  console.log(`Specification: ${specResult.output_file}`);
  console.log(`\nNext step: npm run finalize`);

  return {
    phase: 'all',
    success: true,
    output_file: specResult.output_file,
    duration_ms: Date.now() - startTime,
  };
}

// ============================================================================
// Output Parsing Helpers
// ============================================================================

function parseFeaturesPipelineOutput(
  result: PipelineResult,
  interview: InterviewOutput,
  presetUsed: string
): FeaturesPhaseOutput {
  // Try to parse JSON from chairman response
  let parsed: any = {};
  try {
    const jsonMatch = result.stage3.response.match(/```json\s*([\s\S]*?)\s*```/);
    const jsonContent = jsonMatch ? jsonMatch[1] : result.stage3.response;
    parsed = JSON.parse(jsonContent);
  } catch {
    // Try smart parser - extract from sections
    const smartResult = smartParseChairmanOutput(result.stage3.response);
    if (smartResult.success && smartResult.sections.length > 0) {
      // Build parsed object from sections
      for (const section of smartResult.sections) {
        if (section.parsed) {
          parsed[section.name] = section.parsed;
        }
      }
    }
  }

  return {
    metadata: {
      phase: 'features',
      generated_at: new Date().toISOString(),
      interview_hash: hashObject(interview),
      preset_used: presetUsed,
    },
    features: parsed.features || [],
    users: parsed.users || [],
    constraints: parsed.constraints || {},
    ambiguities: (parsed.ambiguities || []).map((a: any, idx: number) => ({
      id: a.id || `FEAT-AMB-${idx + 1}`,
      description: a.description || a.question || '',
      source: a.source || 'missing_info',
      priority: a.priority,
      options: a.options,
      recommendation: a.recommendation,
    })),
  };
}

function parseArchitecturePipelineOutput(
  result: PipelineResult,
  features: FeaturesPhaseOutput,
  presetUsed: string
): ArchitecturePhaseOutput {
  let parsed: any = {};
  try {
    const jsonMatch = result.stage3.response.match(/```json\s*([\s\S]*?)\s*```/);
    const jsonContent = jsonMatch ? jsonMatch[1] : result.stage3.response;
    parsed = JSON.parse(jsonContent);
  } catch {
    const smartResult = smartParseChairmanOutput(result.stage3.response);
    if (smartResult.success && smartResult.sections.length > 0) {
      // Build parsed object from sections
      for (const section of smartResult.sections) {
        if (section.parsed) {
          parsed[section.name] = section.parsed;
        }
      }
    }
  }

  return {
    metadata: {
      phase: 'architecture',
      generated_at: new Date().toISOString(),
      features_hash: hashObject(features),
      preset_used: presetUsed,
    },
    architecture: parsed.architecture || { overview: '', components: [], communication_patterns: '' },
    data_model: parsed.data_model || { entities: [], storage_recommendations: '', data_flow: '' },
    api_contracts: parsed.api_contracts || { style: '', endpoints: [], authentication: '' },
    security: parsed.security || { authentication: '', authorization: '', data_protection: '', threat_model: '' },
    deployment: parsed.deployment || { infrastructure: '', scaling_strategy: '', monitoring: '', ci_cd: '' },
    technology_decisions: parsed.technology_decisions || [],
    ambiguities: (parsed.ambiguities || []).map((a: any, idx: number) => ({
      id: a.id || `ARCH-AMB-${idx + 1}`,
      description: a.description || a.question || '',
      source: a.source || 'missing_info',
      priority: a.priority,
      context: a.context,
      options: a.options,
      recommendation: a.recommendation,
    })),
  };
}

function parseAmbiguitiesFromSection(content: string): Ambiguity[] {
  if (!content) return [];
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function extractAdvisoryConcerns(critiqueResult: CritiqueResult): AdvisoryConcern[] {
  const concerns: AdvisoryConcern[] = [];

  // Advisory critiques are the non-blocking ones
  for (const item of critiqueResult.advisory || []) {
    concerns.push({
      id: `ADV-${concerns.length + 1}`,
      source: item.source,
      category: 'improvement', // advisory items are all improvements
      description: item.description,
      suggestion: item.recommendation,
      severity: 'medium', // CritiqueItem doesn't have severity, use default
    });
  }

  return concerns;
}

function mapCritiqueCategory(category: string): AdvisoryConcern['category'] {
  const mapping: Record<string, AdvisoryConcern['category']> = {
    'risk': 'risk',
    'alternative': 'alternative',
    'clarification': 'clarification',
    'improvement': 'improvement',
    'completeness': 'improvement',
    'clarity': 'clarification',
    'consistency': 'risk',
    'scope': 'risk',
  };
  return mapping[category] || 'improvement';
}

function writeAdvisoryLog(path: string, phase: string, concerns: AdvisoryConcern[]): void {
  const content = `# Advisory Concerns - ${phase.charAt(0).toUpperCase() + phase.slice(1)} Phase

Generated: ${new Date().toISOString()}

These concerns were raised during the critique phase but are not blocking.
Review and address as appropriate.

${concerns.map(c => `
## ${c.id}: ${c.category} (${c.severity})

**Source:** ${c.source}

${c.description}

${c.suggestion ? `**Suggestion:** ${c.suggestion}` : ''}
`).join('\n---\n')}
`;

  writeFileSync(path, content);
}

/**
 * Write full critique log including blocking (applied/rejected) and advisory.
 */
function writeCritiqueLog(path: string, phase: string, critiqueResult: CritiqueResult): void {
  const applied = critiqueResult.blocking?.applied || [];
  const rejected = critiqueResult.blocking?.rejected || [];
  const advisory = critiqueResult.advisory || [];

  const content = `# Critique Results - ${phase.charAt(0).toUpperCase() + phase.slice(1)} Phase

Generated: ${new Date().toISOString()}

## Summary

| Category | Count |
|----------|-------|
| Blocking Applied | ${applied.length} |
| Blocking Rejected | ${rejected.length} |
| Advisory | ${advisory.length} |

---

## Blocking Critiques - Applied (${applied.length})

These critiques were automatically applied to improve the output.

${applied.length === 0 ? '_None_' : applied.map((c, i) => `
### ${i + 1}. [${c.source}] ${c.location || 'General'}

**Issue:** ${c.description}

**Recommendation:** ${c.recommendation || 'N/A'}
`).join('\n---\n')}

---

## Blocking Critiques - Rejected (${rejected.length})

These critiques were raised but rejected by the chairman (already addressed, not applicable, or incorrect).

${rejected.length === 0 ? '_None_' : rejected.map((c, i) => `
### ${i + 1}. [${c.source}] ${c.location || 'General'}

**Issue:** ${c.description}

**Rejection Reason:** ${(c as any).rejectionReason || 'Not specified'}
`).join('\n---\n')}

---

## Advisory Concerns (${advisory.length})

These concerns are logged for human review but not automatically applied.

${advisory.length === 0 ? '_None_' : advisory.map((c, i) => `
### ${i + 1}. [${c.source}] ${c.location || 'General'}

**Concern:** ${c.description}

**Recommendation:** ${c.recommendation || 'N/A'}
`).join('\n---\n')}
`;

  writeFileSync(path, content);
}

// ============================================================================
// Input Loading
// ============================================================================

function loadInputFile<T>(path: string): T {
  if (!existsSync(path)) {
    throw new Error(`Input file not found: ${path}`);
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function validateInputs(phase: PhaseName, inputs: string[]): void {
  switch (phase) {
    case 'architecture':
      if (inputs.length === 0) {
        throw new Error('Architecture phase requires --input with features file');
      }
      break;
    case 'spec':
      if (inputs.length < 2) {
        throw new Error('Spec phase requires --input with features file AND architecture file');
      }
      break;
    case 'tests':
      // Tests phase reads from spec-final.json directly, no explicit input required
      // The test-council module handles checking for spec-final.json
      break;
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  console.log('='.repeat(60));
  console.log('SPEC WORKFLOW - Phased Mode');
  console.log('='.repeat(60));
  console.log('');

  const config = loadConfig();
  const interview = loadInterview();

  // Validate inputs for phase (tests and features read from fixed paths)
  if (args.phase !== 'all' && args.phase !== 'features' && args.phase !== 'tests') {
    validateInputs(args.phase, args.input || []);
  }

  let result: PhaseResult;

  switch (args.phase) {
    case 'features':
      result = await runFeaturesPhase(interview, config, args);
      break;

    case 'architecture': {
      const features = loadInputFile<FeaturesPhaseOutput>(args.input![0]);
      result = await runArchitecturePhase(features, interview, config, args);
      break;
    }

    case 'spec': {
      // Find features and architecture inputs
      let features: FeaturesPhaseOutput | undefined;
      let architecture: ArchitecturePhaseOutput | undefined;

      for (const inputPath of args.input!) {
        const data = loadInputFile<any>(inputPath);
        if (data.metadata?.phase === 'features') {
          features = data;
        } else if (data.metadata?.phase === 'architecture') {
          architecture = data;
        }
      }

      if (!features || !architecture) {
        console.error('Error: Spec phase requires both features and architecture inputs');
        process.exit(1);
      }

      result = await runSpecPhase(features, architecture, interview, config, args);
      break;
    }

    case 'tests': {
      result = await runTestsPhase(config, args);
      break;
    }

    case 'all':
    default:
      result = await runAllPhases(interview, config, args);
      break;
  }

  // Print summary
  console.log('');
  console.log('='.repeat(60));
  console.log(`Phase: ${result.phase}`);
  console.log(`Status: ${result.success ? 'SUCCESS' : 'FAILED'}`);
  console.log(`Duration: ${(result.duration_ms / 1000).toFixed(1)}s`);
  if (result.output_file) console.log(`Output: ${result.output_file}`);
  if (result.advisory_file) console.log(`Advisory: ${result.advisory_file}`);
  if (result.error) console.log(`Error: ${result.error}`);
  console.log('='.repeat(60));

  process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
  console.error('Phase orchestrator failed:', err);
  process.exit(1);
});
