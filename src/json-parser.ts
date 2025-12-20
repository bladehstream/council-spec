/**
 * Smart JSON fallback parser for chairman output.
 *
 * Handles malformed/truncated JSON responses with multiple recovery strategies:
 * 1. Strip markdown fences
 * 2. Direct JSON.parse
 * 3. Repair truncated JSON (add missing brackets)
 * 4. Extract sections by key pattern
 * 5. Per-section JSON repair
 */

export interface ParsedSection {
  name: string;
  content: string;
  parsed: unknown | null;  // Parsed JSON if successful, null if raw string
  complete: boolean;       // True if cleanly parsed, false if repaired/raw
}

export interface SmartParseResult {
  success: boolean;
  method: 'json' | 'repaired' | 'extracted' | 'failed';
  sections: ParsedSection[];
  raw: string;
  errors: string[];
}

/**
 * Known section keys we expect in chairman output
 */
const KNOWN_SECTIONS = [
  'executive_summary',
  'ambiguities',
  'consensus_notes',
  'implementation_phases',
  'architecture',
  'data_model',
  'api_contracts',
  'user_flows',
  'security',
  'deployment',
  'confidence_level',
  'key_risks',
] as const;

/**
 * Step 1: Strip markdown code fences
 */
export function stripMarkdownFences(input: string): string {
  let result = input.trim();

  // Remove opening fence
  if (result.startsWith('```json')) {
    result = result.slice(7);
  } else if (result.startsWith('```')) {
    result = result.slice(3);
  }

  // Remove closing fence
  if (result.endsWith('```')) {
    result = result.slice(0, -3);
  }

  return result.trim();
}

/**
 * Step 3: Repair truncated JSON by adding missing closing brackets
 * Tracks the actual order of opening brackets to close them correctly.
 */
export function repairTruncatedJson(input: string): string | null {
  const openBraces = (input.match(/\{/g) || []).length;
  const closeBraces = (input.match(/\}/g) || []).length;
  const openBrackets = (input.match(/\[/g) || []).length;
  const closeBrackets = (input.match(/\]/g) || []).length;

  const missingBraces = openBraces - closeBraces;
  const missingBrackets = openBrackets - closeBrackets;

  if (missingBraces < 0 || missingBrackets < 0) {
    // More closes than opens - can't repair
    return null;
  }

  if (missingBraces === 0 && missingBrackets === 0) {
    // Already balanced
    return input;
  }

  // Remove trailing incomplete content (partial strings, etc.)
  let repaired = input.trimEnd();

  // Remove trailing comma if present
  if (repaired.endsWith(',')) {
    repaired = repaired.slice(0, -1);
  }

  // Remove incomplete string at end (starts with " but no closing ")
  const lastQuote = repaired.lastIndexOf('"');
  const secondLastQuote = repaired.lastIndexOf('"', lastQuote - 1);
  if (lastQuote > secondLastQuote) {
    // Check if there's an odd number of quotes suggesting incomplete string
    const quoteCount = (repaired.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      // Find and remove the incomplete string
      repaired = repaired.slice(0, lastQuote) + '"';
    }
  }

  // Track bracket order to close in correct sequence
  // Scan through and record order of unclosed brackets
  const unclosed: ('{' | '[')[] = [];
  let inString = false;

  for (let i = 0; i < repaired.length; i++) {
    const char = repaired[i];
    const prevChar = i > 0 ? repaired[i - 1] : '';

    // Track string state
    if (char === '"' && prevChar !== '\\') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{' || char === '[') {
        unclosed.push(char);
      } else if (char === '}') {
        // Find last unclosed {
        for (let j = unclosed.length - 1; j >= 0; j--) {
          if (unclosed[j] === '{') {
            unclosed.splice(j, 1);
            break;
          }
        }
      } else if (char === ']') {
        // Find last unclosed [
        for (let j = unclosed.length - 1; j >= 0; j--) {
          if (unclosed[j] === '[') {
            unclosed.splice(j, 1);
            break;
          }
        }
      }
    }
  }

  // Close in reverse order (LIFO)
  for (let i = unclosed.length - 1; i >= 0; i--) {
    repaired += unclosed[i] === '{' ? '}' : ']';
  }

  return repaired;
}

/**
 * Step 4: Extract a section by key pattern
 * Finds "key": { or "key": [ and extracts the balanced content
 */
export function extractSectionByKey(input: string, key: string): string | null {
  // Pattern to find the key and its value start
  const keyPattern = new RegExp(`"${key}"\\s*:\\s*([{\\["']|\\d|true|false|null)`, 'i');
  const match = input.match(keyPattern);

  if (!match || match.index === undefined) {
    return null;
  }

  const valueStart = match.index + match[0].length - 1;
  const firstChar = input[valueStart];

  // Handle primitive values
  if (firstChar === '"') {
    // String value - find closing quote
    let i = valueStart + 1;
    while (i < input.length) {
      if (input[i] === '"' && input[i - 1] !== '\\') {
        return input.slice(valueStart, i + 1);
      }
      i++;
    }
    // Unclosed string - return what we have
    return input.slice(valueStart) + '"';
  }

  if (/\d/.test(firstChar) || firstChar === 't' || firstChar === 'f' || firstChar === 'n') {
    // Number, boolean, or null - find end
    const endMatch = input.slice(valueStart).match(/^[\w.+-]+/);
    return endMatch ? endMatch[0] : null;
  }

  // Object or array - track bracket depth
  const isArray = firstChar === '[';
  const openBracket = isArray ? '[' : '{';
  const closeBracket = isArray ? ']' : '}';

  let depth = 0;
  let inString = false;
  let i = valueStart;

  while (i < input.length) {
    const char = input[i];
    const prevChar = i > 0 ? input[i - 1] : '';

    // Track string state (ignore brackets inside strings)
    if (char === '"' && prevChar !== '\\') {
      inString = !inString;
    }

    if (!inString) {
      if (char === openBracket || char === '{' || char === '[') {
        depth++;
      } else if (char === closeBracket || char === '}' || char === ']') {
        depth--;
        if (depth === 0) {
          return input.slice(valueStart, i + 1);
        }
      }
    }

    i++;
  }

  // Didn't find closing bracket - return what we have and try to repair
  const partial = input.slice(valueStart);
  return repairTruncatedJson(partial);
}

/**
 * Try to parse a string as JSON, with repair attempts
 */
export function tryParseJson(input: string): { success: boolean; value: unknown; repaired: boolean } {
  // Try direct parse
  try {
    return { success: true, value: JSON.parse(input), repaired: false };
  } catch {
    // Try repair
    const repaired = repairTruncatedJson(input);
    if (repaired && repaired !== input) {
      try {
        return { success: true, value: JSON.parse(repaired), repaired: true };
      } catch {
        // Fall through
      }
    }
    return { success: false, value: null, repaired: false };
  }
}

/**
 * Main smart parser function
 */
export function smartParseChairmanOutput(rawInput: string): SmartParseResult {
  const errors: string[] = [];
  const sections: ParsedSection[] = [];

  // Step 1: Strip markdown fences
  const input = stripMarkdownFences(rawInput);

  // Step 2: Try direct JSON parse
  const directParse = tryParseJson(input);

  if (directParse.success && typeof directParse.value === 'object' && directParse.value !== null) {
    const obj = directParse.value as Record<string, unknown>;

    // Extract sections from parsed object
    for (const key of KNOWN_SECTIONS) {
      if (key in obj) {
        const value = obj[key];
        const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        sections.push({
          name: key,
          content,
          parsed: value,
          complete: true,
        });
      }
    }

    return {
      success: true,
      method: directParse.repaired ? 'repaired' : 'json',
      sections,
      raw: input,
      errors,
    };
  }

  errors.push('Direct JSON parse failed, trying section extraction');

  // Step 4: Extract sections by key pattern
  for (const key of KNOWN_SECTIONS) {
    const extracted = extractSectionByKey(input, key);

    if (extracted) {
      const parsed = tryParseJson(extracted);

      sections.push({
        name: key,
        content: extracted,
        parsed: parsed.success ? parsed.value : null,
        complete: parsed.success && !parsed.repaired,
      });

      if (!parsed.success) {
        errors.push(`Section '${key}' extracted but JSON parse failed`);
      } else if (parsed.repaired) {
        errors.push(`Section '${key}' JSON was repaired`);
      }
    }
  }

  if (sections.length > 0) {
    return {
      success: true,
      method: 'extracted',
      sections,
      raw: input,
      errors,
    };
  }

  // All methods failed
  errors.push('All parsing methods failed');

  return {
    success: false,
    method: 'failed',
    sections: [],
    raw: input,
    errors,
  };
}

/**
 * Convert SmartParseResult sections to a Map for easy lookup
 * (compatible with existing council.ts code)
 */
export function sectionsToMap(result: SmartParseResult): Map<string, { name: string; content: string; complete: boolean }> {
  return new Map(
    result.sections.map(s => [s.name, { name: s.name, content: s.content, complete: s.complete }])
  );
}
