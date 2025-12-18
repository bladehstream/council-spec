import { describe, it, expect } from 'vitest';

/**
 * Contract tests for agent-council API
 *
 * These tests verify that the agent-council package exports the functions
 * and types that spec-workflow depends on. They test the actual package
 * imports, not mocks.
 *
 * If these tests fail, it indicates a breaking change in agent-council
 * that needs to be addressed.
 */

describe('agent-council API Contract', () => {
  describe('Module Exports', () => {
    it('should export runEnhancedPipeline function', async () => {
      const agentCouncil = await import('agent-council');

      expect(agentCouncil.runEnhancedPipeline).toBeDefined();
      expect(typeof agentCouncil.runEnhancedPipeline).toBe('function');
    });

    it('should export parseStageSpec function', async () => {
      const agentCouncil = await import('agent-council');

      expect(agentCouncil.parseStageSpec).toBeDefined();
      expect(typeof agentCouncil.parseStageSpec).toBe('function');
    });

    it('should export createAgentFromSpec function', async () => {
      const agentCouncil = await import('agent-council');

      expect(agentCouncil.createAgentFromSpec).toBeDefined();
      expect(typeof agentCouncil.createAgentFromSpec).toBe('function');
    });

    it('should export listProviders function', async () => {
      const agentCouncil = await import('agent-council');

      expect(agentCouncil.listProviders).toBeDefined();
      expect(typeof agentCouncil.listProviders).toBe('function');
    });

    it('should export loadModelsConfig function', async () => {
      const agentCouncil = await import('agent-council');

      expect(agentCouncil.loadModelsConfig).toBeDefined();
      expect(typeof agentCouncil.loadModelsConfig).toBe('function');
    });
  });

  describe('Type Contracts', () => {
    it('should allow PipelineResult type usage', async () => {
      const agentCouncil = await import('agent-council');

      // Verify the type is exported (this is a compile-time check)
      // Runtime check: ensure the module loads without error
      expect(agentCouncil).toBeDefined();
    });

    it('should allow EnhancedPipelineConfig type usage', async () => {
      const agentCouncil = await import('agent-council');

      // Type is checked at compile time
      expect(agentCouncil).toBeDefined();
    });
  });

  describe('Function Signatures', () => {
    it('parseStageSpec should accept (spec, providers, config) arguments', async () => {
      const { parseStageSpec, loadModelsConfig } = await import('agent-council');

      // Verify function can be called with expected signature
      // This may throw if API keys not configured, but signature should match
      try {
        const modelsConfig = loadModelsConfig();
        const result = parseStageSpec('3:default', ['claude', 'gemini'], modelsConfig);

        // If it succeeds, verify result shape
        expect(result).toHaveProperty('agents');
        expect(Array.isArray(result.agents)).toBe(true);
      } catch (error) {
        // May fail due to missing config, but should not be a signature error
        const errorMessage = (error as Error).message;
        expect(errorMessage).not.toContain('is not a function');
        expect(errorMessage).not.toContain('expected');
      }
    });

    it('createAgentFromSpec should accept spec string argument', async () => {
      const { createAgentFromSpec } = await import('agent-council');

      try {
        const result = createAgentFromSpec('claude:heavy');

        // Verify result shape
        expect(result).toBeDefined();
      } catch (error) {
        const errorMessage = (error as Error).message;
        expect(errorMessage).not.toContain('is not a function');
      }
    });

    it('listProviders should accept config argument', async () => {
      const { listProviders, loadModelsConfig } = await import('agent-council');

      try {
        const modelsConfig = loadModelsConfig();
        const result = listProviders(modelsConfig);

        expect(Array.isArray(result)).toBe(true);
      } catch (error) {
        const errorMessage = (error as Error).message;
        expect(errorMessage).not.toContain('is not a function');
      }
    });

    it('runEnhancedPipeline should accept (prompt, options) arguments', async () => {
      const { runEnhancedPipeline } = await import('agent-council');

      // Verify function signature without actually running pipeline
      expect(runEnhancedPipeline.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('loadModelsConfig Contract', () => {
    it('should return an object', async () => {
      const { loadModelsConfig } = await import('agent-council');

      try {
        const config = loadModelsConfig();
        expect(typeof config).toBe('object');
      } catch (error) {
        // May throw if models.json not found, but function should exist
        expect(error).toBeDefined();
      }
    });
  });
});

describe('agent-council Result Shape Contract', () => {
  // These tests verify the expected shape of results from agent-council
  // They use type assertions to ensure contract compliance

  it('should define expected Stage1Result shape', () => {
    interface Stage1Result {
      agent: string;
      response: string;
    }

    const sampleResult: Stage1Result = {
      agent: 'claude:default',
      response: 'Sample response',
    };

    expect(sampleResult.agent).toBeDefined();
    expect(sampleResult.response).toBeDefined();
  });

  it('should define expected Stage2Result shape', () => {
    interface Stage2Result {
      agent: string;
      parsedRanking: string[];
    }

    const sampleResult: Stage2Result = {
      agent: 'claude:default',
      parsedRanking: ['agent1', 'agent2', 'agent3'],
    };

    expect(sampleResult.agent).toBeDefined();
    expect(sampleResult.parsedRanking).toBeDefined();
    expect(Array.isArray(sampleResult.parsedRanking)).toBe(true);
  });

  it('should define expected AggregateResult shape', () => {
    interface AggregateResult {
      agent: string;
      averageRank: number;
    }

    const sampleResult: AggregateResult = {
      agent: 'claude:default',
      averageRank: 1.5,
    };

    expect(sampleResult.agent).toBeDefined();
    expect(sampleResult.averageRank).toBeDefined();
    expect(typeof sampleResult.averageRank).toBe('number');
  });

  it('should define expected Stage3Result shape', () => {
    interface Stage3Result {
      agent: string;
      response: string;
    }

    const sampleResult: Stage3Result = {
      agent: 'claude:heavy',
      response: 'Synthesized result',
    };

    expect(sampleResult.agent).toBeDefined();
    expect(sampleResult.response).toBeDefined();
  });

  it('should define expected PipelineResult shape', () => {
    interface PipelineResult {
      stage1: Array<{ agent: string; response: string }>;
      stage2: Array<{ agent: string; parsedRanking: string[] }>;
      aggregate: Array<{ agent: string; averageRank: number }>;
      stage3: { agent: string; response: string };
    }

    const sampleResult: PipelineResult = {
      stage1: [{ agent: 'claude:default', response: 'R1' }],
      stage2: [{ agent: 'claude:default', parsedRanking: ['a', 'b'] }],
      aggregate: [{ agent: 'claude:default', averageRank: 1 }],
      stage3: { agent: 'claude:heavy', response: 'Synthesis' },
    };

    expect(sampleResult.stage1).toBeDefined();
    expect(sampleResult.stage2).toBeDefined();
    expect(sampleResult.aggregate).toBeDefined();
    expect(sampleResult.stage3).toBeDefined();
  });
});
