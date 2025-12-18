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
 * Looks for structured question tables and bullet points.
 */
export function extractAmbiguities(synthesis: string): CouncilOutput['ambiguities'] {
  const ambiguities: CouncilOutput['ambiguities'] = [];
  let id = 1;

  // Look for markdown table rows with questions (| # | Question | ... |)
  // Match rows like: | 1 | **Question text?** | ... |
  const tableRowPattern = /\|\s*(\d+)\s*\|\s*\*\*([^*|]+\??)\*\*\s*\|/g;
  let match;
  while ((match = tableRowPattern.exec(synthesis)) !== null) {
    const question = match[2].trim();
    // Skip if it's just a header or too short
    if (question.length > 10 && !question.toLowerCase().includes('question')) {
      ambiguities.push({
        id: `AMB-${id++}`,
        description: question,
        source: 'divergent_responses',
      });
    }
  }

  // Also look for bullet points with questions
  // Match: - **Question?** or * **Question?**
  const bulletPattern = /^[\s]*[-*]\s*\*\*([^*]+\?)\*\*/gm;
  while ((match = bulletPattern.exec(synthesis)) !== null) {
    const question = match[1].trim();
    // Avoid duplicates
    if (!ambiguities.some(a => a.description.includes(question.slice(0, 30)))) {
      ambiguities.push({
        id: `AMB-${id++}`,
        description: question,
        source: 'divergent_responses',
      });
    }
  }

  // Look for "Critical" or "Important" sections with numbered items
  const criticalSection = synthesis.match(/### Critical[^#]*?(?=###|$)/is);
  if (criticalSection) {
    const numberedPattern = /\|\s*\d+\s*\|\s*\*\*([^|*]+)\*\*\s*\|([^|]*)\|([^|]*)\|/g;
    while ((match = numberedPattern.exec(criticalSection[0])) !== null) {
      const question = match[1].trim();
      const recommendation = match[3]?.trim();
      if (question.length > 5 && !ambiguities.some(a => a.description === question)) {
        ambiguities.push({
          id: `AMB-${id++}`,
          description: question,
          source: 'divergent_responses',
          options: recommendation ? [recommendation] : undefined,
        });
      }
    }
  }

  return ambiguities;
}

/**
 * Extract specification sections from chairman synthesis text.
 * Looks for numbered top-level sections (## 1. Architecture, etc.)
 */
export function extractSpecSections(synthesis: string): CouncilOutput['spec_sections'] {
  const sections: CouncilOutput['spec_sections'] = {};

  // Match numbered sections like "## 1. Architecture Recommendations"
  // Capture content until the next ## section or end
  const sectionMappings: Array<{ key: keyof NonNullable<CouncilOutput['spec_sections']>; pattern: RegExp }> = [
    { key: 'architecture', pattern: /##\s*\d+\.\s*Architecture[^\n]*\n([\s\S]*?)(?=\n##\s*\d+\.|$)/i },
    { key: 'data_model', pattern: /##\s*\d+\.\s*Data Model[^\n]*\n([\s\S]*?)(?=\n##\s*\d+\.|$)/i },
    { key: 'api_contracts', pattern: /##\s*\d+\.\s*API Contracts[^\n]*\n([\s\S]*?)(?=\n##\s*\d+\.|$)/i },
    { key: 'user_flows', pattern: /##\s*\d+\.\s*User Flows[^\n]*\n([\s\S]*?)(?=\n##\s*\d+\.|$)/i },
    { key: 'security', pattern: /##\s*\d+\.\s*Security[^\n]*\n([\s\S]*?)(?=\n##\s*\d+\.|$)/i },
    { key: 'deployment', pattern: /##\s*\d+\.\s*Deployment[^\n]*\n([\s\S]*?)(?=\n##\s*\d+\.|$)/i },
  ];

  for (const { key, pattern } of sectionMappings) {
    const match = synthesis.match(pattern);
    if (match && match[1]) {
      // Trim and limit to reasonable size (first 5000 chars)
      const content = match[1].trim();
      sections[key] = content.length > 5000 ? content.slice(0, 5000) + '\n...[truncated]' : content;
    }
  }

  return sections;
}
