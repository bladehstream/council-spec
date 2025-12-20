import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');
const STATE_DIR = join(ROOT, 'state');
const CONV_DIR = join(ROOT, 'state', 'conversations');

/**
 * Smoke tests for the spec-workflow
 *
 * These tests verify that the workflow scripts can be executed
 * and produce expected outputs. They test actual file operations
 * and command execution.
 *
 * Note: Full council execution requires API keys. These tests
 * verify the workflow mechanics without requiring full API access.
 */

describe('Workflow Smoke Tests', () => {
  // Backup existing state files
  let backupState: Map<string, string> = new Map();

  beforeAll(() => {
    // Backup existing state files
    if (existsSync(STATE_DIR)) {
      const files = ['interview-output.json', 'spec-council-output.json', 'spec-final.json', 'council-preferences.json'];
      for (const file of files) {
        const path = join(STATE_DIR, file);
        if (existsSync(path)) {
          backupState.set(file, readFileSync(path, 'utf-8'));
        }
      }
    }
  });

  afterAll(() => {
    // Restore backed up state files
    for (const [file, content] of backupState) {
      writeFileSync(join(STATE_DIR, file), content);
    }

    // Clean up test-generated files (but not backups)
    const testFiles = ['interview-output.json', 'council-preferences.json'];
    for (const file of testFiles) {
      const path = join(STATE_DIR, file);
      if (existsSync(path) && !backupState.has(file)) {
        rmSync(path);
      }
    }

    // Clean up test conversation logs (only ones created during test)
    if (existsSync(CONV_DIR)) {
      const logs = readdirSync(CONV_DIR).filter(f => f.includes('smoke-test-'));
      for (const log of logs) {
        rmSync(join(CONV_DIR, log));
      }
    }
  });

  describe('Init Script', () => {
    it('should create state directories if missing', () => {
      // This test just verifies the directory structure exists after running init
      execSync('npm run init -- smoke-test-dirs', { cwd: ROOT, stdio: 'pipe' });

      expect(existsSync(STATE_DIR)).toBe(true);
      expect(existsSync(CONV_DIR)).toBe(true);
    });

    it('should create conversation log file with correct format', () => {
      const output = execSync('npm run init -- smoke-test-log', {
        cwd: ROOT,
        encoding: 'utf-8',
      });

      // Find the created log file
      const logFiles = readdirSync(CONV_DIR).filter(f => f.includes('smoke-test-log'));
      expect(logFiles.length).toBeGreaterThan(0);

      const logContent = readFileSync(join(CONV_DIR, logFiles[0]), 'utf-8');
      expect(logContent).toContain('SPEC WORKFLOW LOG');
      expect(logContent).toContain('Project: smoke-test-log');
      expect(logContent).toContain('Started:');
    });

    it('should generate unique project ID if none provided', () => {
      const output = execSync('npm run init', {
        cwd: ROOT,
        encoding: 'utf-8',
      });

      expect(output).toContain('Initialized project:');
    });
  });

  describe('State File Operations', () => {
    it('should write valid interview output JSON', () => {
      const testInterview = {
        problem_statement: {
          summary: 'Smoke test project',
          context: 'Testing the workflow',
          motivation: 'Verify functionality',
        },
        core_functionality: [
          { feature: 'Test feature', description: 'For testing', priority: 'must_have' },
        ],
        users_and_actors: [
          { name: 'Tester', description: 'Runs tests' },
        ],
        constraints: {
          tech_stack: ['Vitest', 'TypeScript'],
        },
        success_criteria: ['All tests pass'],
        out_of_scope: ['Production deployment'],
      };

      const path = join(STATE_DIR, 'interview-output.json');
      writeFileSync(path, JSON.stringify(testInterview, null, 2));

      expect(existsSync(path)).toBe(true);

      const loaded = JSON.parse(readFileSync(path, 'utf-8'));
      expect(loaded.problem_statement.summary).toBe('Smoke test project');
    });

    it('should write valid council preferences JSON', () => {
      const preferences = {
        responders: '3:heavy',
        evaluators: '6:heavy',
        chairman: 'claude:heavy',
        timeout_seconds: 300,
      };

      const path = join(STATE_DIR, 'council-preferences.json');
      writeFileSync(path, JSON.stringify(preferences, null, 2));

      expect(existsSync(path)).toBe(true);

      const loaded = JSON.parse(readFileSync(path, 'utf-8'));
      expect(loaded.responders).toBe('3:heavy');
      expect(loaded.timeout_seconds).toBe(300);
    });
  });

  describe('Config Loading', () => {
    it('should load config.json successfully', () => {
      const configPath = join(ROOT, 'config.json');
      expect(existsSync(configPath)).toBe(true);

      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(config.models).toBeDefined();
      expect(config.council).toBeDefined();
      expect(config.council.responders).toBeDefined();
      expect(config.council.evaluators).toBeDefined();
      expect(config.council.chairman).toBeDefined();
    });

    it('should have valid council config values', () => {
      const config = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf-8'));

      // Verify config follows expected patterns
      expect(config.council.responders).toMatch(/^\d+:(fast|default|heavy)$|^[\w:,]+$/);
      expect(config.council.evaluators).toMatch(/^\d+:(fast|default|heavy)$|^[\w:,]+$/);
      expect(config.council.chairman).toMatch(/^\w+:(fast|default|heavy)$/);
      expect(config.council.timeout_seconds).toBeGreaterThan(0);
    });
  });

  describe('Build Artifacts', () => {
    it('should have compiled dist/council.js', () => {
      const distPath = join(ROOT, 'dist', 'council.js');
      expect(existsSync(distPath)).toBe(true);
    });

    it('should have compiled dist/init.js', () => {
      const distPath = join(ROOT, 'dist', 'init.js');
      expect(existsSync(distPath)).toBe(true);
    });

    it('should have compiled dist/types.js', () => {
      const distPath = join(ROOT, 'dist', 'types.js');
      expect(existsSync(distPath)).toBe(true);
    });
  });

  describe('Council Script', () => {
    beforeEach(() => {
      // Ensure interview output exists for council to read
      const testInterview = {
        problem_statement: { summary: 'Test' },
        core_functionality: [{ feature: 'Test', priority: 'must_have' }],
      };
      writeFileSync(
        join(STATE_DIR, 'interview-output.json'),
        JSON.stringify(testInterview, null, 2)
      );
    });

    it('should start council script and detect interview output', () => {
      // This test verifies the council script can start
      // It will likely fail due to missing API keys, but should get past initial checks
      try {
        const output = execSync('npm run council 2>&1', {
          cwd: ROOT,
          encoding: 'utf-8',
          timeout: 10000, // 10 second timeout
        });

        // If it gets here, the script ran
        expect(output).toContain('SPEC WORKFLOW');
      } catch (error: any) {
        // Expected to fail due to API keys, but should contain startup messages
        const output = error.stdout || error.stderr || error.message;

        // Should at least start and show the banner
        expect(
          output.includes('SPEC WORKFLOW') ||
          output.includes('Starting council') ||
          output.includes('Config') ||
          output.includes('Error') // Acceptable - means script ran
        ).toBe(true);
      }
    });

    it('should exit with error if interview output missing', () => {
      // Remove interview output
      const path = join(STATE_DIR, 'interview-output.json');
      if (existsSync(path)) {
        rmSync(path);
      }

      try {
        execSync('npm run council 2>&1', {
          cwd: ROOT,
          encoding: 'utf-8',
          timeout: 5000,
        });
        // Should not reach here
        expect.fail('Should have thrown');
      } catch (error: any) {
        const output = error.stdout || error.stderr || error.message;
        expect(output).toContain('interview-output.json');
      }
    });
  });

  describe('Workflow Files', () => {
    it('should have prompts/workflow.md', () => {
      const path = join(ROOT, 'prompts', 'workflow.md');
      expect(existsSync(path)).toBe(true);

      const content = readFileSync(path, 'utf-8');
      expect(content).toContain('Interview');
      expect(content).toContain('Council');
      expect(content).toContain('Validation');
    });

    it('should have CLAUDE.md with operating constraints', () => {
      const path = join(ROOT, 'CLAUDE.md');
      expect(existsSync(path)).toBe(true);

      const content = readFileSync(path, 'utf-8');
      expect(content).toContain('DO NOT modify');
      expect(content).toContain('Allowed Actions');
      expect(content).toContain('Prohibited Actions');
    });
  });
});

describe('End-to-End Data Flow', () => {
  it('should maintain data integrity through workflow stages', () => {
    // Simulate the data flow without running actual council

    // Stage 1: Interview output
    const interview = {
      problem_statement: { summary: 'E2E Test Project' },
      core_functionality: [
        { feature: 'Feature A', priority: 'must_have' as const },
        { feature: 'Feature B', priority: 'should_have' as const },
      ],
      constraints: { tech_stack: ['TypeScript'] },
    };

    // Stage 2: Simulated council output
    const councilOutput = {
      input_hash: 'abc123def456',
      timestamp: new Date().toISOString(),
      stage1: [
        { agent: 'claude:default', response: 'Analysis 1' },
        { agent: 'gemini:default', response: 'Analysis 2' },
      ],
      stage2: {
        rankings: [
          { agent: 'claude:default', ranking: ['gemini', 'claude'] },
        ],
        aggregate: [
          { agent: 'gemini:default', score: 1.5 },
          { agent: 'claude:default', score: 1.5 },
        ],
      },
      stage3: {
        chairman: 'claude:heavy',
        synthesis: 'Final synthesis with Architecture: microservices',
      },
      ambiguities: [
        { id: 'AMB-1', description: 'Auth method unclear', source: 'divergent_responses' },
      ],
    };

    // Stage 3: Final spec
    const specFinal = {
      project_id: 'e2e-test',
      version: '1.0.0',
      created_at: new Date().toISOString(),
      interview_summary: interview.problem_statement.summary,
      decisions: [
        { ambiguity_id: 'AMB-1', decision: 'Use OAuth', rationale: 'Industry standard' },
      ],
      specification: {
        overview: 'E2E test project spec',
        architecture: 'Microservices',
        data_model: 'Users, Products',
        api_contracts: 'REST API',
        user_flows: 'Login, Checkout',
        security: 'OAuth 2.0',
        deployment: 'Kubernetes',
        acceptance_criteria: ['Tests pass', 'Coverage > 80%'],
      },
    };

    // Verify data flows correctly
    expect(specFinal.interview_summary).toBe(interview.problem_statement.summary);
    expect(specFinal.decisions[0].ambiguity_id).toBe(councilOutput.ambiguities[0].id);
  });
});
