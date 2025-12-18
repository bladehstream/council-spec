import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync } from 'fs';
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
import type { InterviewOutput, CouncilOutput, Config } from './types.js';
import { formatList, extractAmbiguities, extractSpecSections } from './utils.js';

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

    // Build pipeline config
    const pipelineConfig: EnhancedPipelineConfig = {
      stage1: { agents: stage1Spec.agents },
      stage2: { agents: stage2Spec.agents },
      stage3: {
        chairman,
        useReasoning: false,
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
        },
        onStage2Complete: (rankings, aggregate) => {
          console.log(`\nStage 2 complete: ${rankings.length} rankings`);
        },
        onStage3Complete: (synthesis) => {
          console.log(`\nStage 3 complete: Chairman synthesis received`);
        },
      },
    });

    if (!result) {
      throw new Error('Council pipeline returned no results');
    }

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
        synthesis: result.stage3.response,
      },
      ambiguities: extractAmbiguities(result.stage3.response),
      spec_sections: extractSpecSections(result.stage3.response),
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
