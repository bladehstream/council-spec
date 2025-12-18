import { describe, it, expect } from 'vitest';
import { formatList, extractAmbiguities, extractSpecSections } from '../../src/utils.js';

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

  it('should handle ambiguities plural form', () => {
    const synthesis = 'Ambiguities: Multiple areas need clarification including auth and storage.';
    const result = extractAmbiguities(synthesis);
    expect(result.length).toBe(1);
    expect(result[0].description).toContain('Multiple areas');
  });

  it('should trim whitespace from descriptions', () => {
    const synthesis = 'Question:   Lots of spaces here   ';
    const result = extractAmbiguities(synthesis);
    expect(result[0].description).toBe('Lots of spaces here');
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

  it('should handle Database as data model header', () => {
    const synthesis = `
## Database:
PostgreSQL with normalized schema.
    `;

    const result = extractSpecSections(synthesis);
    expect(result.data_model).toContain('PostgreSQL');
  });

  it('should handle Critical Paths as user flows header', () => {
    const synthesis = `
## Critical Paths:
Login -> Dashboard -> Action.
    `;

    const result = extractSpecSections(synthesis);
    expect(result.user_flows).toContain('Login');
  });

  it('should handle Authorization as security header', () => {
    const synthesis = `
## Authorization:
Role-based access control.
    `;

    const result = extractSpecSections(synthesis);
    expect(result.security).toContain('Role-based');
  });

  it('should handle Scaling as deployment header', () => {
    const synthesis = `
## Scaling:
Horizontal scaling with load balancer.
    `;

    const result = extractSpecSections(synthesis);
    expect(result.deployment).toContain('Horizontal scaling');
  });

  it('should handle Interfaces as api_contracts header', () => {
    const synthesis = `
## Interfaces:
GraphQL API with subscriptions.
    `;

    const result = extractSpecSections(synthesis);
    expect(result.api_contracts).toContain('GraphQL');
  });
});
