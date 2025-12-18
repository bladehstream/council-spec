import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    readFileSync: vi.fn(),
    existsSync: vi.fn(),
  };
});

const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>;
const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;

// Replicate the config loading and preferences logic for testing
interface Config {
  models: {
    interview: { provider: string; model: string };
    validation: { provider: string; model: string };
  };
  council: {
    responders: string;
    evaluators: string;
    chairman: string;
    timeout_seconds: number;
  };
}

interface CouncilPreferences {
  responders?: string;
  evaluators?: string;
  chairman?: string;
  timeout_seconds?: number;
}

function loadConfig(configPath: string): Config {
  return JSON.parse(mockReadFileSync(configPath, 'utf-8'));
}

function loadPreferences(prefsPath: string): CouncilPreferences | null {
  if (!mockExistsSync(prefsPath)) return null;
  try {
    return JSON.parse(mockReadFileSync(prefsPath, 'utf-8'));
  } catch {
    return null;
  }
}

function getEffectiveCouncilConfig(
  config: Config,
  preferences: CouncilPreferences | null,
  env: Record<string, string | undefined>
): Config['council'] {
  return {
    responders: env.COUNCIL_RESPONDERS
      || preferences?.responders
      || config.council.responders,
    evaluators: env.COUNCIL_EVALUATORS
      || preferences?.evaluators
      || config.council.evaluators,
    chairman: env.COUNCIL_CHAIRMAN
      || preferences?.chairman
      || config.council.chairman,
    timeout_seconds: env.COUNCIL_TIMEOUT
      ? parseInt(env.COUNCIL_TIMEOUT, 10)
      : preferences?.timeout_seconds
      ?? config.council.timeout_seconds,
  };
}

describe('Config Loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadConfig', () => {
    it('should load and parse config.json', () => {
      const mockConfig: Config = {
        models: {
          interview: { provider: 'claude', model: 'claude-opus-4-5-20250514' },
          validation: { provider: 'claude', model: 'claude-opus-4-5-20250514' },
        },
        council: {
          responders: '3:default',
          evaluators: '3:default',
          chairman: 'claude:heavy',
          timeout_seconds: 180,
        },
      };

      mockReadFileSync.mockReturnValue(JSON.stringify(mockConfig));

      const result = loadConfig('/path/to/config.json');
      expect(result).toEqual(mockConfig);
    });

    it('should throw on invalid JSON', () => {
      mockReadFileSync.mockReturnValue('not valid json');
      expect(() => loadConfig('/path/to/config.json')).toThrow();
    });
  });

  describe('loadPreferences', () => {
    it('should return null if preferences file does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      const result = loadPreferences('/path/to/prefs.json');
      expect(result).toBeNull();
    });

    it('should load preferences when file exists', () => {
      const mockPrefs: CouncilPreferences = {
        responders: '3:heavy',
        evaluators: '6:heavy',
        chairman: 'claude:heavy',
        timeout_seconds: 300,
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(mockPrefs));

      const result = loadPreferences('/path/to/prefs.json');
      expect(result).toEqual(mockPrefs);
    });

    it('should return null on parse error', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('invalid json');

      const result = loadPreferences('/path/to/prefs.json');
      expect(result).toBeNull();
    });
  });

  describe('getEffectiveCouncilConfig', () => {
    const baseConfig: Config = {
      models: {
        interview: { provider: 'claude', model: 'claude-opus-4-5-20250514' },
        validation: { provider: 'claude', model: 'claude-opus-4-5-20250514' },
      },
      council: {
        responders: '3:default',
        evaluators: '3:default',
        chairman: 'claude:default',
        timeout_seconds: 180,
      },
    };

    it('should use config.json values when no overrides', () => {
      const result = getEffectiveCouncilConfig(baseConfig, null, {});
      expect(result).toEqual(baseConfig.council);
    });

    it('should override with preferences when present', () => {
      const preferences: CouncilPreferences = {
        responders: '3:heavy',
        chairman: 'claude:heavy',
      };

      const result = getEffectiveCouncilConfig(baseConfig, preferences, {});
      expect(result.responders).toBe('3:heavy');
      expect(result.evaluators).toBe('3:default'); // not overridden
      expect(result.chairman).toBe('claude:heavy');
      expect(result.timeout_seconds).toBe(180); // not overridden
    });

    it('should override with env vars (highest priority)', () => {
      const preferences: CouncilPreferences = {
        responders: '3:heavy',
      };

      const env = {
        COUNCIL_RESPONDERS: '5:fast',
        COUNCIL_TIMEOUT: '600',
      };

      const result = getEffectiveCouncilConfig(baseConfig, preferences, env);
      expect(result.responders).toBe('5:fast'); // env beats preferences
      expect(result.timeout_seconds).toBe(600); // env beats config
    });

    it('should respect full priority chain: env > prefs > config', () => {
      const preferences: CouncilPreferences = {
        responders: '3:heavy',
        evaluators: '6:heavy',
        chairman: 'gemini:heavy',
        timeout_seconds: 300,
      };

      const env = {
        COUNCIL_CHAIRMAN: 'claude:heavy',
      };

      const result = getEffectiveCouncilConfig(baseConfig, preferences, env);
      expect(result.responders).toBe('3:heavy'); // from prefs
      expect(result.evaluators).toBe('6:heavy'); // from prefs
      expect(result.chairman).toBe('claude:heavy'); // from env (overrides prefs)
      expect(result.timeout_seconds).toBe(300); // from prefs
    });
  });
});
