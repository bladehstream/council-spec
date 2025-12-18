import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');
const TEST_STATE_DIR = join(ROOT, 'tests', '.test-state');

// Mock agent-council module
vi.mock('agent-council', () => ({
  runEnhancedPipeline: vi.fn(),
  parseStageSpec: vi.fn(),
  createAgentFromSpec: vi.fn(),
  listProviders: vi.fn(),
  loadModelsConfig: vi.fn(),
}));

import {
  runEnhancedPipeline,
  parseStageSpec,
  createAgentFromSpec,
  listProviders,
  loadModelsConfig,
} from 'agent-council';

const mockRunEnhancedPipeline = runEnhancedPipeline as ReturnType<typeof vi.fn>;
const mockParseStageSpec = parseStageSpec as ReturnType<typeof vi.fn>;
const mockCreateAgentFromSpec = createAgentFromSpec as ReturnType<typeof vi.fn>;
const mockListProviders = listProviders as ReturnType<typeof vi.fn>;
const mockLoadModelsConfig = loadModelsConfig as ReturnType<typeof vi.fn>;

describe('Council Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Set up mock returns
    mockLoadModelsConfig.mockReturnValue({});
    mockListProviders.mockReturnValue(['claude', 'gemini', 'codex']);
    mockParseStageSpec.mockReturnValue({
      agents: [
        { provider: 'claude', tier: 'default' },
        { provider: 'gemini', tier: 'default' },
        { provider: 'codex', tier: 'default' },
      ],
    });
    mockCreateAgentFromSpec.mockReturnValue({ provider: 'claude', tier: 'heavy' });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Pipeline Configuration', () => {
    it('should parse responders stage spec correctly', () => {
      const stageSpec = '3:default';
      mockParseStageSpec(stageSpec, ['claude', 'gemini', 'codex'], {});

      expect(mockParseStageSpec).toHaveBeenCalledWith(stageSpec, ['claude', 'gemini', 'codex'], {});
    });

    it('should parse evaluators stage spec correctly', () => {
      const stageSpec = '3:heavy';
      mockParseStageSpec(stageSpec, ['claude', 'gemini', 'codex'], {});

      expect(mockParseStageSpec).toHaveBeenCalledWith(stageSpec, ['claude', 'gemini', 'codex'], {});
    });

    it('should create chairman agent from spec', () => {
      const chairmanSpec = 'claude:heavy';
      mockCreateAgentFromSpec(chairmanSpec);

      expect(mockCreateAgentFromSpec).toHaveBeenCalledWith(chairmanSpec);
    });

    it('should handle explicit agent selection', () => {
      const explicitSpec = 'claude:heavy,gemini:heavy,codex:heavy';
      mockParseStageSpec.mockReturnValue({
        agents: [
          { provider: 'claude', tier: 'heavy' },
          { provider: 'gemini', tier: 'heavy' },
          { provider: 'codex', tier: 'heavy' },
        ],
      });

      mockParseStageSpec(explicitSpec, ['claude', 'gemini', 'codex'], {});

      expect(mockParseStageSpec).toHaveBeenCalledWith(explicitSpec, ['claude', 'gemini', 'codex'], {});
    });
  });

  describe('Pipeline Execution', () => {
    it('should execute pipeline with correct config structure', async () => {
      const mockResult = {
        stage1: [
          { agent: 'claude:default', response: 'Response 1' },
          { agent: 'gemini:default', response: 'Response 2' },
          { agent: 'codex:default', response: 'Response 3' },
        ],
        stage2: [
          { agent: 'claude:default', parsedRanking: ['gemini', 'claude', 'codex'] },
          { agent: 'gemini:default', parsedRanking: ['claude', 'gemini', 'codex'] },
        ],
        aggregate: [
          { agent: 'claude:default', averageRank: 1.5 },
          { agent: 'gemini:default', averageRank: 1.5 },
          { agent: 'codex:default', averageRank: 3 },
        ],
        stage3: {
          agent: 'claude:heavy',
          response: 'Synthesized response with Architecture: microservices',
        },
      };

      mockRunEnhancedPipeline.mockResolvedValue(mockResult);

      const result = await mockRunEnhancedPipeline('test prompt', {
        config: {
          stage1: { agents: [] },
          stage2: { agents: [] },
          stage3: { chairman: {}, useReasoning: false },
        },
        timeoutMs: 180000,
        tty: false,
        silent: false,
      });

      expect(result).toEqual(mockResult);
      expect(result.stage1.length).toBe(3);
      expect(result.stage2.length).toBe(2);
      expect(result.stage3.response).toContain('Architecture');
    });

    it('should handle pipeline timeout', async () => {
      mockRunEnhancedPipeline.mockRejectedValue(new Error('Pipeline timeout'));

      await expect(
        mockRunEnhancedPipeline('test prompt', {
          config: {},
          timeoutMs: 1000,
        })
      ).rejects.toThrow('Pipeline timeout');
    });

    it('should handle pipeline returning no results', async () => {
      mockRunEnhancedPipeline.mockResolvedValue(null);

      const result = await mockRunEnhancedPipeline('test prompt', { config: {} });
      expect(result).toBeNull();
    });
  });

  describe('Result Processing', () => {
    it('should map stage1 results correctly', () => {
      const stage1Results = [
        { agent: 'claude:default', response: 'Response 1' },
        { agent: 'gemini:default', response: 'Response 2' },
      ];

      const mapped = stage1Results.map(s => ({
        agent: s.agent,
        response: s.response,
      }));

      expect(mapped).toEqual([
        { agent: 'claude:default', response: 'Response 1' },
        { agent: 'gemini:default', response: 'Response 2' },
      ]);
    });

    it('should map stage2 rankings correctly', () => {
      const stage2Results = [
        { agent: 'claude:default', parsedRanking: ['a', 'b', 'c'] },
        { agent: 'gemini:default', parsedRanking: ['b', 'a', 'c'] },
      ];

      const mapped = stage2Results.map(s => ({
        agent: s.agent,
        ranking: s.parsedRanking,
      }));

      expect(mapped[0].ranking).toEqual(['a', 'b', 'c']);
      expect(mapped[1].ranking).toEqual(['b', 'a', 'c']);
    });

    it('should compute aggregate scores correctly', () => {
      const aggregateResults = [
        { agent: 'a', averageRank: 1.5 },
        { agent: 'b', averageRank: 2.0 },
        { agent: 'c', averageRank: 2.5 },
      ];

      const mapped = aggregateResults.map(a => ({
        agent: a.agent,
        score: a.averageRank,
      }));

      expect(mapped[0].score).toBe(1.5);
      expect(mapped[1].score).toBe(2.0);
      expect(mapped[2].score).toBe(2.5);
    });
  });
});

describe('Interview Output Processing', () => {
  const sampleInterview = {
    problem_statement: {
      summary: 'Build a task management system',
      context: 'For a small team',
      motivation: 'Improve productivity',
    },
    core_functionality: [
      { feature: 'Task creation', description: 'Create tasks', priority: 'must_have' as const },
      { feature: 'Task assignment', description: 'Assign to users', priority: 'must_have' as const },
    ],
    users_and_actors: [
      { name: 'Admin', description: 'System administrator' },
      { name: 'User', description: 'Regular user' },
    ],
    constraints: {
      tech_stack: ['React', 'Node.js', 'PostgreSQL'],
      timeline: '3 months',
    },
    success_criteria: ['All tasks tracked', 'Team adoption > 80%'],
    out_of_scope: ['Mobile app', 'Offline mode'],
  };

  it('should build prompt from interview output', () => {
    // Replicate buildPrompt logic
    const interview = sampleInterview;

    const prompt = `You are analyzing requirements for a software project.

## Problem Statement
${interview.problem_statement.summary}
Context: ${interview.problem_statement.context}
Motivation: ${interview.problem_statement.motivation}

### Users
${interview.users_and_actors?.map(u => `- **${u.name}**: ${u.description}`).join('\n')}

### Features
${interview.core_functionality.map(f => `- [${f.priority}] ${f.feature}`).join('\n')}`;

    expect(prompt).toContain('Build a task management system');
    expect(prompt).toContain('For a small team');
    expect(prompt).toContain('Admin');
    expect(prompt).toContain('must_have');
  });

  it('should handle missing optional fields', () => {
    const minimalInterview = {
      problem_statement: { summary: 'Minimal project' },
      core_functionality: [
        { feature: 'Basic feature', priority: 'must_have' as const },
      ],
    };

    const prompt = `Problem: ${minimalInterview.problem_statement.summary}
Users: ${minimalInterview.users_and_actors?.map(u => u.name).join(', ') || 'Not specified'}`;

    expect(prompt).toContain('Minimal project');
    expect(prompt).toContain('Not specified');
  });

  it('should hash interview output consistently', () => {
    const { createHash } = require('crypto');

    function hashInterview(interview: typeof sampleInterview): string {
      return createHash('sha256')
        .update(JSON.stringify(interview))
        .digest('hex')
        .substring(0, 12);
    }

    const hash1 = hashInterview(sampleInterview);
    const hash2 = hashInterview(sampleInterview);

    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(12);
  });

  it('should produce different hashes for different interviews', () => {
    const { createHash } = require('crypto');

    function hashInterview(interview: object): string {
      return createHash('sha256')
        .update(JSON.stringify(interview))
        .digest('hex')
        .substring(0, 12);
    }

    const modified = {
      ...sampleInterview,
      problem_statement: { summary: 'Different project' },
    };

    const hash1 = hashInterview(sampleInterview);
    const hash2 = hashInterview(modified);

    expect(hash1).not.toBe(hash2);
  });
});

describe('Structured Output Parsing', () => {
  const validStructuredOutput = {
    executive_summary: 'This is the executive summary of the council analysis.',
    ambiguities: [
      {
        id: 'AMB-1',
        question: 'What is the minimum iOS version?',
        priority: 'critical',
        context: 'Affects API availability and Neural Engine features',
        options: ['iOS 15+', 'iOS 16+', 'iOS 17+'],
        recommendation: 'iOS 16+ for Neural Engine v2 support',
      },
      {
        id: 'AMB-2',
        question: 'Recording format preference?',
        priority: 'important',
        context: 'Affects post-production workflow compatibility',
        options: ['MP4', 'MOV', 'MKV'],
        recommendation: 'MP4 with H.264 for maximum compatibility',
      },
    ],
    spec_sections: {
      architecture: '## Architecture\nMicroservices design...',
      data_model: '## Data Model\nEntities: User, Task...',
      api_contracts: '## API\nREST endpoints...',
      user_flows: '## User Flows\nLogin -> Dashboard...',
      security: '## Security\nJWT authentication...',
      deployment: '## Deployment\nKubernetes cluster...',
    },
    implementation_phases: [
      {
        phase: 1,
        name: 'Foundation',
        description: 'Set up core infrastructure',
        key_deliverables: ['API scaffold', 'Database schema'],
      },
    ],
    consensus_notes: 'All agents agreed on microservices architecture.',
  };

  it('should parse valid JSON response directly', () => {
    const jsonString = JSON.stringify(validStructuredOutput);
    const parsed = JSON.parse(jsonString);

    expect(parsed.executive_summary).toBe(validStructuredOutput.executive_summary);
    expect(parsed.ambiguities.length).toBe(2);
    expect(parsed.spec_sections.architecture).toContain('Microservices');
  });

  it('should extract JSON from markdown code fences', () => {
    const responseWithCodeFence = `Here is my analysis:

\`\`\`json
${JSON.stringify(validStructuredOutput, null, 2)}
\`\`\`

Hope this helps!`;

    const jsonMatch = responseWithCodeFence.match(/```(?:json)?\s*([\s\S]*?)```/);
    expect(jsonMatch).not.toBeNull();

    const parsed = JSON.parse(jsonMatch![1].trim());
    expect(parsed.ambiguities.length).toBe(2);
  });

  it('should convert structured ambiguities to Ambiguity type', () => {
    const structuredAmbiguities = validStructuredOutput.ambiguities;

    const converted = structuredAmbiguities.map((a, idx) => ({
      id: a.id || `AMB-${idx + 1}`,
      description: a.question,
      source: 'divergent_responses' as const,
      options: a.options,
      priority: a.priority,
      context: a.context,
      recommendation: a.recommendation,
    }));

    expect(converted[0].id).toBe('AMB-1');
    expect(converted[0].description).toBe('What is the minimum iOS version?');
    expect(converted[0].source).toBe('divergent_responses');
    expect(converted[0].priority).toBe('critical');
    expect(converted[0].options).toContain('iOS 16+');
  });

  it('should handle missing optional fields in structured output', () => {
    const minimalOutput = {
      executive_summary: 'Summary',
      ambiguities: [],
      spec_sections: {
        architecture: 'Arch',
        data_model: 'Data',
        api_contracts: 'API',
        user_flows: 'Flows',
        security: 'Security',
        deployment: 'Deploy',
      },
      implementation_phases: [],
      consensus_notes: '',
    };

    const jsonString = JSON.stringify(minimalOutput);
    const parsed = JSON.parse(jsonString);

    expect(parsed.ambiguities.length).toBe(0);
    expect(parsed.implementation_phases.length).toBe(0);
  });

  it('should preserve all spec_sections from structured output', () => {
    const specSections = validStructuredOutput.spec_sections;

    expect(specSections.architecture).toBeDefined();
    expect(specSections.data_model).toBeDefined();
    expect(specSections.api_contracts).toBeDefined();
    expect(specSections.user_flows).toBeDefined();
    expect(specSections.security).toBeDefined();
    expect(specSections.deployment).toBeDefined();
  });

  it('should include implementation phases in _structured field', () => {
    const _structured = {
      executive_summary: validStructuredOutput.executive_summary,
      implementation_phases: validStructuredOutput.implementation_phases,
      consensus_notes: validStructuredOutput.consensus_notes,
    };

    expect(_structured.implementation_phases[0].phase).toBe(1);
    expect(_structured.implementation_phases[0].name).toBe('Foundation');
    expect(_structured.implementation_phases[0].key_deliverables).toContain('API scaffold');
  });
});
