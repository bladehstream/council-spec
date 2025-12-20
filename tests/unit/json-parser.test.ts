import { describe, it, expect } from 'vitest';
import {
  stripMarkdownFences,
  repairTruncatedJson,
  extractSectionByKey,
  tryParseJson,
  smartParseChairmanOutput,
  sectionsToMap,
} from '../../src/json-parser.js';

describe('json-parser', () => {
  describe('stripMarkdownFences', () => {
    it('should strip ```json fence with newlines', () => {
      const input = '```json\n{"key": "value"}\n```';
      expect(stripMarkdownFences(input)).toBe('{"key": "value"}');
    });

    it('should strip ```json fence without trailing newline', () => {
      const input = '```json\n{"key": "value"}```';
      expect(stripMarkdownFences(input)).toBe('{"key": "value"}');
    });

    it('should strip plain ``` fence with newlines', () => {
      const input = '```\n{"key": "value"}\n```';
      expect(stripMarkdownFences(input)).toBe('{"key": "value"}');
    });

    it('should handle complex JSON with newlines', () => {
      const input = '```json\n{\n  "key": "value",\n  "nested": {\n    "x": 1\n  }\n}\n```';
      const result = stripMarkdownFences(input);
      expect(result.startsWith('{')).toBe(true);
      expect(result.endsWith('}')).toBe(true);
      expect(JSON.parse(result)).toEqual({ key: 'value', nested: { x: 1 } });
    });

    it('should handle input without fences', () => {
      const input = '{"key": "value"}';
      expect(stripMarkdownFences(input)).toBe('{"key": "value"}');
    });

    it('should trim whitespace', () => {
      const input = '  ```json\n{"key": "value"}\n```  ';
      expect(stripMarkdownFences(input)).toBe('{"key": "value"}');
    });
  });

  describe('repairTruncatedJson', () => {
    it('should add missing closing braces', () => {
      const input = '{"key": {"nested": "value"';
      const result = repairTruncatedJson(input);
      expect(result).toBe('{"key": {"nested": "value"}}');
    });

    it('should add missing closing brackets', () => {
      const input = '{"items": [1, 2, 3';
      const result = repairTruncatedJson(input);
      expect(result).toBe('{"items": [1, 2, 3]}');
    });

    it('should handle mixed brackets', () => {
      const input = '{"items": [{"name": "test"';
      const result = repairTruncatedJson(input);
      expect(result).toBe('{"items": [{"name": "test"}]}');
    });

    it('should remove trailing comma', () => {
      const input = '{"key": "value",';
      const result = repairTruncatedJson(input);
      expect(result).toBe('{"key": "value"}');
    });

    it('should return null for more closes than opens', () => {
      const input = '{"key": "value"}}}';  // Extra closing braces
      const result = repairTruncatedJson(input);
      expect(result).toBeNull();
    });

    it('should return input if already balanced', () => {
      const input = '{"key": "value"}';
      const result = repairTruncatedJson(input);
      expect(result).toBe(input);
    });
  });

  describe('extractSectionByKey', () => {
    it('should extract object section', () => {
      const input = '{"architecture": {"components": ["A", "B"]}, "other": "value"}';
      const result = extractSectionByKey(input, 'architecture');
      expect(result).toBe('{"components": ["A", "B"]}');
    });

    it('should extract array section', () => {
      const input = '{"items": [1, 2, 3], "other": "value"}';
      const result = extractSectionByKey(input, 'items');
      expect(result).toBe('[1, 2, 3]');
    });

    it('should extract string section', () => {
      const input = '{"summary": "This is a test", "other": "value"}';
      const result = extractSectionByKey(input, 'summary');
      expect(result).toBe('"This is a test"');
    });

    it('should handle nested objects', () => {
      const input = '{"data": {"level1": {"level2": {"value": 42}}}}';
      const result = extractSectionByKey(input, 'data');
      expect(result).toBe('{"level1": {"level2": {"value": 42}}}');
    });

    it('should return null for missing key', () => {
      const input = '{"other": "value"}';
      const result = extractSectionByKey(input, 'missing');
      expect(result).toBeNull();
    });

    it('should handle truncated section', () => {
      const input = '{"architecture": {"components": ["A", "B"';
      const result = extractSectionByKey(input, 'architecture');
      expect(result).not.toBeNull();
      // Should attempt repair
      expect(result).toContain('"components"');
    });
  });

  describe('tryParseJson', () => {
    it('should parse valid JSON', () => {
      const result = tryParseJson('{"key": "value"}');
      expect(result.success).toBe(true);
      expect(result.value).toEqual({ key: 'value' });
      expect(result.repaired).toBe(false);
    });

    it('should repair and parse truncated JSON', () => {
      const result = tryParseJson('{"key": "value"');
      expect(result.success).toBe(true);
      expect(result.value).toEqual({ key: 'value' });
      expect(result.repaired).toBe(true);
    });

    it('should fail for invalid JSON', () => {
      const result = tryParseJson('not json at all');
      expect(result.success).toBe(false);
      expect(result.value).toBeNull();
    });
  });

  describe('smartParseChairmanOutput', () => {
    it('should parse clean JSON response', () => {
      const input = JSON.stringify({
        executive_summary: 'Test summary',
        architecture: { components: ['A'] },
        ambiguities: [],
      });

      const result = smartParseChairmanOutput(input);
      expect(result.success).toBe(true);
      expect(result.method).toBe('json');
      expect(result.sections.length).toBe(3);
    });

    it('should parse JSON with markdown fences', () => {
      const input = '```json\n' + JSON.stringify({
        executive_summary: 'Test summary',
        architecture: { components: ['A'] },
      }) + '\n```';

      const result = smartParseChairmanOutput(input);
      expect(result.success).toBe(true);
      expect(result.method).toBe('json');
    });

    it('should repair truncated JSON', () => {
      const input = '{"executive_summary": "Test", "architecture": {"components": ["A"';

      const result = smartParseChairmanOutput(input);
      expect(result.success).toBe(true);
      expect(result.method).toBe('repaired');
    });

    it('should extract sections from malformed JSON', () => {
      // JSON where only some sections are extractable
      const input = '{"executive_summary": "Test summary", "architecture": {"x": 1}, garbage here';

      const result = smartParseChairmanOutput(input);
      expect(result.success).toBe(true);
      expect(result.method).toBe('extracted');
      expect(result.sections.some(s => s.name === 'executive_summary')).toBe(true);
      expect(result.sections.some(s => s.name === 'architecture')).toBe(true);
    });

    it('should handle complete spec response', () => {
      const input = JSON.stringify({
        executive_summary: 'A comprehensive summary',
        ambiguities: [{ id: 'AMB-1', question: 'What DB?' }],
        architecture: { components: ['API', 'DB', 'UI'] },
        data_model: { entities: ['User', 'Order'] },
        api_contracts: { endpoints: ['/api/users'] },
        user_flows: ['Login', 'Checkout'],
        security: { auth: 'JWT' },
        deployment: { platform: 'AWS' },
      });

      const result = smartParseChairmanOutput(input);
      expect(result.success).toBe(true);
      expect(result.sections.length).toBe(8);
    });
  });

  describe('sectionsToMap', () => {
    it('should convert sections to Map', () => {
      const input = JSON.stringify({
        executive_summary: 'Test',
        architecture: { x: 1 },
      });

      const result = smartParseChairmanOutput(input);
      const map = sectionsToMap(result);

      expect(map.has('executive_summary')).toBe(true);
      expect(map.has('architecture')).toBe(true);
      expect(map.get('executive_summary')?.content).toBe('Test');
    });
  });
});
