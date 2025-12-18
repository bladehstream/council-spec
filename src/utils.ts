import type { CouncilOutput } from './types.js';

/**
 * Safely format a field that should be an array but might be string, object, or array.
 * Handles various input formats from interview data that may not match expected types.
 */
export function formatList(value: unknown, fallback = 'Not specified'): string {
  if (!value) return fallback;
  if (Array.isArray(value)) return value.join(', ') || fallback;
  if (typeof value === 'string') return value || fallback;
  if (typeof value === 'object') {
    // Handle object with nested values (e.g., {frontend: "React", backend: "Node"})
    return Object.entries(value)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ') || fallback;
  }
  return String(value);
}

/**
 * Extract ambiguities from chairman synthesis text.
 * Looks for common patterns indicating unclear requirements or questions.
 */
export function extractAmbiguities(synthesis: string): CouncilOutput['ambiguities'] {
  const ambiguities: CouncilOutput['ambiguities'] = [];

  const patterns = [
    /ambiguit(?:y|ies)[:\s]+([^\n]+)/gi,
    /clarification needed[:\s]+([^\n]+)/gi,
    /unclear[:\s]+([^\n]+)/gi,
    /question[:\s]+([^\n]+)/gi,
    /missing information[:\s]+([^\n]+)/gi
  ];

  let id = 1;
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(synthesis)) !== null) {
      ambiguities.push({
        id: `AMB-${id++}`,
        description: match[1].trim(),
        source: 'divergent_responses',
      });
    }
  }

  return ambiguities;
}

/**
 * Extract specification sections from chairman synthesis text.
 * Matches common section headers and extracts their content.
 */
export function extractSpecSections(synthesis: string): CouncilOutput['spec_sections'] {
  const sections: CouncilOutput['spec_sections'] = {};

  const sectionPatterns: Record<keyof NonNullable<CouncilOutput['spec_sections']>, RegExp> = {
    architecture: /(?:architecture|system design)[:\s]*\n([\s\S]*?)(?=\n##|\n\*\*|$)/i,
    data_model: /(?:data model|entities|database)[:\s]*\n([\s\S]*?)(?=\n##|\n\*\*|$)/i,
    api_contracts: /(?:api|endpoints|interfaces)[:\s]*\n([\s\S]*?)(?=\n##|\n\*\*|$)/i,
    user_flows: /(?:user flows|user journey|critical paths)[:\s]*\n([\s\S]*?)(?=\n##|\n\*\*|$)/i,
    security: /(?:security|authentication|authorization)[:\s]*\n([\s\S]*?)(?=\n##|\n\*\*|$)/i,
    deployment: /(?:deployment|infrastructure|scaling)[:\s]*\n([\s\S]*?)(?=\n##|\n\*\*|$)/i
  };

  for (const [key, pattern] of Object.entries(sectionPatterns)) {
    const match = synthesis.match(pattern);
    if (match) {
      sections[key as keyof typeof sections] = match[1].trim();
    }
  }

  return sections;
}
