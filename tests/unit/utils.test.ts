import { describe, it, expect } from 'vitest';

// Since the utility functions in council.ts are not exported,
// we replicate and test the core logic here to ensure correctness.
// These should be kept in sync with src/council.ts

/**
 * Safely format a field that should be an array but might be string, object, or array
 */
function formatList(value: unknown, fallback = 'Not specified'): string {
  if (!value) return fallback;
  if (Array.isArray(value)) return value.join(', ') || fallback;
  if (typeof value === 'string') return value || fallback;
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ') || fallback;
  }
  return String(value);
}

/**
 * Extract ambiguities from synthesis text
 */
function extractAmbiguities(synthesis: string): Array<{
  id: string;
  description: string;
  source: string;
}> {
  const ambiguities: Array<{ id: string; description: string; source: string }> = [];

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
 * Extract spec sections from synthesis text
 */
function extractSpecSections(synthesis: string): Record<string, string> {
  const sections: Record<string, string> = {};

  const sectionPatterns: Record<string, RegExp> = {
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
      sections[key] = match[1].trim();
    }
  }

  return sections;
}

describe('formatList', () => {
  it('should return fallback for null/undefined', () => {
    expect(formatList(null)).toBe('Not specified');
    expect(formatList(undefined)).toBe('Not specified');
    expect(formatList(null, 'Custom fallback')).toBe('Custom fallback');
  });

  it('should handle arrays', () => {
    expect(formatList(['React', 'Node', 'PostgreSQL'])).toBe('React, Node, PostgreSQL');
    expect(formatList([])).toBe('Not specified');
    expect(formatList(['single'])).toBe('single');
  });

  it('should handle strings', () => {
    expect(formatList('React and Node')).toBe('React and Node');
    expect(formatList('')).toBe('Not specified');
  });

  it('should handle objects', () => {
    expect(formatList({ frontend: 'React', backend: 'Node' })).toBe('frontend: React, backend: Node');
    expect(formatList({})).toBe('Not specified');
  });

  it('should handle other types', () => {
    expect(formatList(42)).toBe('42');
    expect(formatList(true)).toBe('true');
  });
});

describe('extractAmbiguities', () => {
  it('should extract ambiguities with various patterns', () => {
    const synthesis = `
## Analysis

Ambiguity: The user authentication method is not specified.
Clarification needed: Should we support OAuth or just email/password?
Question: What is the expected user load?
Missing information: Database backup strategy not defined.
    `;

    const result = extractAmbiguities(synthesis);

    expect(result.length).toBe(4);
    expect(result[0].id).toBe('AMB-1');
    expect(result[0].description).toBe('The user authentication method is not specified.');
    expect(result[0].source).toBe('divergent_responses');
  });

  it('should return empty array for synthesis without ambiguities', () => {
    const synthesis = 'Everything is clear and well-defined.';
    const result = extractAmbiguities(synthesis);
    expect(result).toEqual([]);
  });

  it('should handle multiple ambiguities of same type', () => {
    const synthesis = `
Question: First question here
Question: Second question here
    `;

    const result = extractAmbiguities(synthesis);
    expect(result.length).toBe(2);
    expect(result[0].id).toBe('AMB-1');
    expect(result[1].id).toBe('AMB-2');
  });

  it('should handle unclear pattern', () => {
    const synthesis = 'Unclear: The scope of the project needs definition.';
    const result = extractAmbiguities(synthesis);
    expect(result.length).toBe(1);
    expect(result[0].description).toBe('The scope of the project needs definition.');
  });
});

describe('extractSpecSections', () => {
  it('should extract architecture section', () => {
    const synthesis = `
## Architecture:
The system uses a microservices architecture with three main services.

## Security:
JWT-based authentication with refresh tokens.
    `;

    const result = extractSpecSections(synthesis);
    expect(result.architecture).toContain('microservices architecture');
    expect(result.security).toContain('JWT-based authentication');
  });

  it('should extract data model section', () => {
    const synthesis = `
## Data Model:
Users, Orders, and Products are the main entities.

## Other:
Some other content.
    `;

    const result = extractSpecSections(synthesis);
    expect(result.data_model).toContain('Users, Orders, and Products');
  });

  it('should return empty object for synthesis without sections', () => {
    const synthesis = 'Just some plain text without any section headers.';
    const result = extractSpecSections(synthesis);
    expect(Object.keys(result).length).toBe(0);
  });

  it('should handle alternative section names', () => {
    const synthesis = `
## System Design:
A monolithic application design.

## Entities:
User, Product, Order entities.

## Endpoints:
REST API endpoints.

## Authentication:
OAuth 2.0 implementation.

## Infrastructure:
AWS deployment.

## User Journey:
Checkout flow.
    `;

    const result = extractSpecSections(synthesis);
    expect(result.architecture).toContain('monolithic');
    expect(result.data_model).toContain('User, Product, Order');
    expect(result.api_contracts).toContain('REST API');
    expect(result.security).toContain('OAuth 2.0');
    expect(result.deployment).toContain('AWS');
    expect(result.user_flows).toContain('Checkout');
  });
});
