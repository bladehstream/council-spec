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
  it('should extract questions from markdown tables', () => {
    const synthesis = `
### Critical Questions

| # | Question | Impact | Recommendation |
|---|----------|--------|----------------|
| 1 | **Minimum iOS version?** | Affects API availability | iOS 16+ recommended |
| 2 | **What is the bitrate floor?** | Video quality threshold | 250 kbps |
| 3 | **Remote onboarding priority?** | Which method first | QR code primary |
    `;

    const result = extractAmbiguities(synthesis);

    expect(result.length).toBe(3);
    expect(result[0].id).toBe('AMB-1');
    expect(result[0].description).toBe('Minimum iOS version?');
    expect(result[0].source).toBe('divergent_responses');
    expect(result[1].description).toBe('What is the bitrate floor?');
    expect(result[2].description).toBe('Remote onboarding priority?');
  });

  it('should return empty array for synthesis without ambiguities', () => {
    const synthesis = 'Everything is clear and well-defined.';
    const result = extractAmbiguities(synthesis);
    expect(result).toEqual([]);
  });

  it('should extract questions from bullet points', () => {
    const synthesis = `
## Open Questions

- **Should we support OAuth?**
- **What is the expected user load?**
    `;

    const result = extractAmbiguities(synthesis);
    expect(result.length).toBe(2);
    expect(result[0].id).toBe('AMB-1');
    expect(result[0].description).toBe('Should we support OAuth?');
    expect(result[1].description).toBe('What is the expected user load?');
  });

  it('should skip table header rows', () => {
    const synthesis = `
| # | Question | Impact |
|---|----------|--------|
| 1 | **What framework to use?** | Architecture choice |
    `;

    const result = extractAmbiguities(synthesis);
    expect(result.length).toBe(1);
    expect(result[0].description).toBe('What framework to use?');
    // Should NOT contain "Question" from header
    expect(result.every(a => !a.description.toLowerCase().includes('question'))).toBe(true);
  });

  it('should extract from Critical sections with recommendations', () => {
    const synthesis = `
### Critical

| # | Issue | Impact | Recommendation |
|---|-------|--------|----------------|
| 1 | **Database selection** | Performance | Use PostgreSQL |
| 2 | **Auth method** | Security | JWT with refresh |
    `;

    const result = extractAmbiguities(synthesis);
    expect(result.length).toBe(2);
    expect(result[0].description).toBe('Database selection');
    expect(result[1].description).toBe('Auth method');
  });

  it('should deduplicate similar questions', () => {
    const synthesis = `
| 1 | **What is the timeout?** | Config |

- **What is the timeout?**
    `;

    const result = extractAmbiguities(synthesis);
    // Should only have one, not two
    expect(result.length).toBe(1);
  });
});

describe('extractSpecSections', () => {
  it('should extract numbered architecture section', () => {
    const synthesis = `
## 1. Architecture Recommendations
The system uses a microservices architecture with three main services.

## 2. Data Model
Users, Orders, and Products are the main entities.
    `;

    const result = extractSpecSections(synthesis);
    expect(result.architecture).toContain('microservices architecture');
  });

  it('should extract numbered data model section', () => {
    const synthesis = `
## 1. Architecture
Some architecture content.

## 2. Data Model
Users, Orders, and Products are the main entities.

## 3. API Contracts
REST endpoints here.
    `;

    const result = extractSpecSections(synthesis);
    expect(result.data_model).toContain('Users, Orders, and Products');
  });

  it('should return empty object for synthesis without numbered sections', () => {
    const synthesis = 'Just some plain text without any section headers.';
    const result = extractSpecSections(synthesis);
    expect(Object.keys(result).length).toBe(0);
  });

  it('should extract all six standard sections', () => {
    const synthesis = `
## 1. Architecture Recommendations
Microservices design pattern.

## 2. Data Model
User, Product, Order entities.

## 3. API Contracts
REST API with versioning.

## 4. User Flows
Checkout flow details.

## 5. Security Considerations
OAuth 2.0 implementation.

## 6. Deployment Strategy
AWS with auto-scaling.
    `;

    const result = extractSpecSections(synthesis);
    expect(result.architecture).toContain('Microservices');
    expect(result.data_model).toContain('User, Product, Order');
    expect(result.api_contracts).toContain('REST API');
    expect(result.user_flows).toContain('Checkout');
    expect(result.security).toContain('OAuth 2.0');
    expect(result.deployment).toContain('AWS');
  });

  it('should handle section content until next numbered section', () => {
    const synthesis = `
## 1. Architecture
First line of architecture.
Second line of architecture.

### Subsection
More details here.

## 2. Data Model
Data model content.
    `;

    const result = extractSpecSections(synthesis);
    expect(result.architecture).toContain('First line');
    expect(result.architecture).toContain('Subsection');
    expect(result.architecture).not.toContain('Data model content');
  });

  it('should handle last section without trailing section', () => {
    const synthesis = `
## 5. Security
Security content here.
More security details.

Some final notes.
    `;

    const result = extractSpecSections(synthesis);
    expect(result.security).toContain('Security content');
    expect(result.security).toContain('final notes');
  });

  it('should truncate very long sections', () => {
    const longContent = 'x'.repeat(6000);
    const synthesis = `
## 1. Architecture
${longContent}

## 2. Data Model
Short content.
    `;

    const result = extractSpecSections(synthesis);
    expect(result.architecture!.length).toBeLessThanOrEqual(5020); // 5000 + truncation message
    expect(result.architecture).toContain('[truncated]');
  });
});
