/**
 * Phase-specific prompts for the split workflow.
 *
 * Separating features from architecture prevents:
 * 1. Architecture constraining features: "Real-time sync is hard, so let's not ask for it"
 * 2. Features assuming architecture: "We need a WebSocket server" (that's architecture, not a feature)
 */

import type { InterviewOutput, FeaturesPhaseOutput, ArchitecturePhaseOutput } from './types.js';
import { formatList } from './utils.js';

// ============================================================================
// Features Phase Prompt
// ============================================================================

/**
 * Build prompt for the features phase.
 * Focuses on WHAT the system does, not HOW.
 */
export function buildFeaturesPrompt(interview: InterviewOutput): string {
  return `You are analyzing requirements for a software project to produce a feature specification.

## CRITICAL CONSTRAINT

You must focus ONLY on WHAT the system does from the user's perspective.

DO NOT include:
- Technology choices (e.g., "use React", "PostgreSQL database")
- Implementation details (e.g., "REST API", "microservices")
- System architecture (e.g., "server", "client", "database")
- Component design (e.g., "authentication service")
- Performance implementations (e.g., "caching layer")

DO include:
- Features and capabilities users interact with
- User stories (As a..., I want..., So that...)
- Acceptance criteria (concrete, testable)
- User goals and needs
- Business constraints (timeline, budget, compliance)
- Success criteria from user perspective

## Interview Output

### Problem Statement
${interview.problem_statement.summary}
${interview.problem_statement.context ? `\nContext: ${interview.problem_statement.context}` : ''}
${interview.problem_statement.motivation ? `\nMotivation: ${interview.problem_statement.motivation}` : ''}

### Users and Actors
${interview.users_and_actors?.map(u => `- **${u.name}**: ${u.description || 'No description'}${u.goals?.length ? `\n  Goals: ${u.goals.join(', ')}` : ''}`).join('\n') || 'Not specified'}

### Requested Functionality
${interview.core_functionality.map(f => `- [${f.priority}] **${f.feature}**: ${f.description || 'No description'}`).join('\n')}

### Constraints
- Timeline: ${interview.constraints?.timeline || 'Not specified'}
- Budget: ${interview.constraints?.budget || 'Not specified'}
- Compliance: ${formatList(interview.constraints?.compliance, 'None specified')}

### Integration Points
${interview.integration_points?.map(i => `- **${i.system}** (${i.type}, ${i.direction}): ${i.notes || 'No notes'}`).join('\n') || 'None specified'}

### Success Criteria
${interview.success_criteria?.map(c => `- ${c}`).join('\n') || 'Not specified'}

### Out of Scope
${interview.out_of_scope?.map(o => `- ${o}`).join('\n') || 'Not specified'}

### Open Questions from Interview
${interview.open_questions?.map(q => `- ${q}`).join('\n') || 'None'}

---

## Your Task

Transform these requirements into a structured feature specification.

For each feature:
1. Create a unique ID (FEAT-001, FEAT-002, etc.)
2. Write clear user stories (As a..., I want..., So that...)
3. Define testable acceptance criteria
4. Assign priority (must_have, should_have, nice_to_have)

Identify any ambiguities where human decisions are needed.

## OUTPUT FORMAT

Output ONLY a JSON object with this structure:

{
  "features": [
    {
      "id": "FEAT-001",
      "name": "Feature name",
      "description": "What this feature allows users to do",
      "priority": "must_have",
      "user_stories": [
        {
          "as": "User role",
          "want": "Capability or action",
          "so_that": "Benefit or goal"
        }
      ],
      "acceptance_criteria": [
        "Given X, when Y, then Z",
        "Specific, testable criterion"
      ],
      "category": "Category name (e.g., Authentication, Content, Sharing)"
    }
  ],
  "users": [
    {
      "name": "User type",
      "description": "Who this user is",
      "goals": ["What they want to achieve"]
    }
  ],
  "constraints": {
    "timeline": "Timeline constraint if any",
    "budget": "Budget constraint if any",
    "compliance": ["Compliance requirements"],
    "non_functional": ["Non-functional requirements like accessibility"]
  },
  "ambiguities": [
    {
      "id": "AMB-001",
      "description": "What needs clarification",
      "source": "missing_info",
      "priority": "critical",
      "options": ["Option A", "Option B"],
      "recommendation": "Suggested resolution"
    }
  ]
}

CRITICAL REQUIREMENTS:
- Output ONLY the JSON object, no markdown code fences
- Focus on WHAT users can do, not HOW it's implemented
- Every acceptance criterion must be testable
- Preserve all priorities from the interview`;
}

// ============================================================================
// Architecture Phase Prompt
// ============================================================================

/**
 * Build prompt for the architecture phase.
 * Focuses on HOW to implement the features.
 */
export function buildArchitecturePrompt(
  features: FeaturesPhaseOutput,
  interview: InterviewOutput
): string {
  const featuresList = features.features.map(f =>
    `### ${f.id}: ${f.name}
Priority: ${f.priority}
${f.description}

User Stories:
${f.user_stories.map(s => `- As ${s.as}, I want ${s.want}, so that ${s.so_that}`).join('\n')}

Acceptance Criteria:
${f.acceptance_criteria.map(c => `- ${c}`).join('\n')}`
  ).join('\n\n');

  const usersList = features.users.map(u =>
    `- **${u.name}**: ${u.description}\n  Goals: ${u.goals.join(', ')}`
  ).join('\n');

  return `You are a software architect designing a system to implement specific features.

## CRITICAL CONSTRAINT

You are designing architecture to SUPPORT the features below. Your architecture decisions should:
1. Reference specific features when justifying decisions
2. Explain WHY a technology/approach is chosen for each feature
3. Consider all acceptance criteria when designing components

## Features to Support

${featuresList}

## Users

${usersList}

## Constraints

- Timeline: ${features.constraints.timeline || 'Not specified'}
- Budget: ${features.constraints.budget || 'Not specified'}
- Compliance: ${features.constraints.compliance?.join(', ') || 'None'}
- Non-functional: ${features.constraints.non_functional?.join(', ') || 'None'}

## Technical Constraints from Interview

- Tech Stack: ${formatList(interview.constraints?.tech_stack)}
- Integration Points:
${interview.integration_points?.map(i => `  - ${i.system} (${i.type}, ${i.direction})`).join('\n') || '  None specified'}

---

## Your Task

Design the system architecture to support ALL features above. For each decision:
- Reference which feature(s) it supports
- Explain why this approach over alternatives
- Consider the acceptance criteria

## OUTPUT FORMAT

Output ONLY a JSON object with this structure:

{
  "architecture": {
    "overview": "High-level description of the system architecture",
    "components": [
      {
        "name": "Component name",
        "purpose": "What this component does",
        "technology": "Recommended technology",
        "interfaces": ["Interface it exposes or consumes"]
      }
    ],
    "communication_patterns": "How components interact",
    "diagrams": "ASCII diagram of architecture (optional)"
  },
  "data_model": {
    "entities": [
      {
        "name": "Entity name",
        "description": "Purpose",
        "key_attributes": ["attr1", "attr2"],
        "relationships": ["Relationship descriptions"]
      }
    ],
    "storage_recommendations": "Database choices with rationale",
    "data_flow": "How data moves through the system"
  },
  "api_contracts": {
    "style": "REST/GraphQL/gRPC",
    "endpoints": [
      {
        "method": "GET/POST/etc",
        "path": "/api/path",
        "purpose": "What this endpoint does",
        "request_shape": "Request body structure",
        "response_shape": "Response body structure"
      }
    ],
    "authentication": "Auth mechanism"
  },
  "security": {
    "authentication": "Auth strategy",
    "authorization": "Permission model",
    "data_protection": "Encryption, PII handling",
    "threat_model": "Key threats and mitigations"
  },
  "deployment": {
    "infrastructure": "Cloud/hosting approach",
    "scaling_strategy": "How to handle load",
    "monitoring": "Observability approach",
    "ci_cd": "Deployment pipeline"
  },
  "technology_decisions": [
    {
      "decision": "What was decided",
      "rationale": "Why this approach",
      "alternatives_considered": ["Alt 1", "Alt 2"],
      "supports_features": ["FEAT-001", "FEAT-003"]
    }
  ],
  "ambiguities": [
    {
      "id": "ARCH-AMB-001",
      "description": "What needs clarification",
      "source": "missing_info",
      "priority": "important",
      "context": "Why this matters for architecture",
      "options": ["Option A", "Option B"],
      "recommendation": "Suggested resolution"
    }
  ]
}

CRITICAL REQUIREMENTS:
- Output ONLY the JSON object, no markdown code fences
- Every technology decision must reference which features it supports
- Security must address the compliance constraints
- Components must cover all acceptance criteria from features`;
}

// ============================================================================
// Spec Phase Prompt (from split inputs)
// ============================================================================

/**
 * Build prompt for the spec phase when receiving split inputs.
 * Synthesizes features and architecture into a detailed specification.
 */
export function buildSpecFromPhasesPrompt(
  features: FeaturesPhaseOutput,
  architecture: ArchitecturePhaseOutput,
  interview: InterviewOutput
): string {
  const featuresSummary = features.features.map(f =>
    `- ${f.id}: ${f.name} [${f.priority}]`
  ).join('\n');

  const componentsSummary = architecture.architecture.components.map(c =>
    `- ${c.name}: ${c.purpose} (${c.technology})`
  ).join('\n');

  const decisionsText = architecture.technology_decisions.map(d =>
    `### ${d.decision}
Rationale: ${d.rationale}
Supports: ${d.supports_features.join(', ')}`
  ).join('\n\n');

  return `You are synthesizing a detailed technical specification from feature requirements and architecture design.

## Feature Requirements (WHAT the system does)

### Features
${featuresSummary}

### Detailed Features
${features.features.map(f => `
#### ${f.id}: ${f.name}
${f.description}

User Stories:
${f.user_stories.map(s => `- As ${s.as}, I want ${s.want}, so that ${s.so_that}`).join('\n')}

Acceptance Criteria:
${f.acceptance_criteria.map(c => `- ${c}`).join('\n')}
`).join('\n')}

## Architecture Design (HOW to implement)

### Overview
${architecture.architecture.overview}

### Components
${componentsSummary}

### Technology Decisions
${decisionsText}

### Security Design
- Authentication: ${architecture.security.authentication}
- Authorization: ${architecture.security.authorization}
- Data Protection: ${architecture.security.data_protection}

### Deployment Design
- Infrastructure: ${architecture.deployment.infrastructure}
- Scaling: ${architecture.deployment.scaling_strategy}

## Open Ambiguities

### From Features Phase
${features.ambiguities.map(a => `- ${a.id}: ${a.description}`).join('\n') || 'None'}

### From Architecture Phase
${architecture.ambiguities.map(a => `- ${a.id}: ${a.description}`).join('\n') || 'None'}

---

## Your Task

Synthesize a complete, detailed technical specification that:
1. Traces each spec section back to relevant features and architecture decisions
2. Ensures ALL acceptance criteria from features are addressed
3. Provides implementation details consistent with architecture
4. Consolidates and resolves any conflicts between phases

## OUTPUT FORMAT

Use sectioned format for reliability:

===SECTION:executive_summary===
Comprehensive summary of the specification.
Reference key features by ID and key architecture decisions.
===END:executive_summary===

===SECTION:architecture===
Detailed architecture specification.
Reference which features each component serves.
Include all component details from architecture phase.
===END:architecture===

===SECTION:data_model===
Complete data model specification.
Ensure it supports all feature acceptance criteria.
===END:data_model===

===SECTION:api_contracts===
Detailed API contracts.
Map endpoints to features they support.
===END:api_contracts===

===SECTION:user_flows===
User interaction flows.
Based on user stories from features phase.
===END:user_flows===

===SECTION:security===
Security implementation details.
Ensure compliance constraints are met.
===END:security===

===SECTION:deployment===
Deployment specification.
Include all infrastructure details.
===END:deployment===

===SECTION:traceability===
JSON array mapping spec sections to features:
[
  {"section": "api_contracts", "features": ["FEAT-001", "FEAT-002"], "components": ["API Gateway"]},
  ...
]
===END:traceability===

===SECTION:ambiguities===
JSON array of remaining ambiguities requiring human decision:
[
  {"id": "SPEC-AMB-001", "description": "...", "priority": "critical", "options": [...]}
]
===END:ambiguities===`;
}

// ============================================================================
// Critique Prompts
// ============================================================================

/**
 * Build critique prompt for features phase.
 */
export function buildFeaturesCritiquePrompt(draft: string): string {
  return `You are reviewing a feature specification draft.

## Your Role

Critically analyze this feature specification for:

1. **Completeness**: Are all user needs captured? Any missing features?
2. **Clarity**: Are features well-defined? Can acceptance criteria be tested?
3. **Consistency**: Do features conflict with each other?
4. **Scope Creep**: Are there features that go beyond what was requested?
5. **Missing User Stories**: Are there obvious user scenarios not addressed?
6. **Ambiguity**: Are there unclear requirements that need human decision?

## Draft to Review

${draft}

## Output Format

For each issue found, categorize as:

**BLOCKING** (must fix before proceeding):
- Missing critical feature
- Conflicting requirements
- Untestable acceptance criteria

**ADVISORY** (log for human review):
- Alternative approach suggestions
- Potential scope concerns
- Clarification recommendations

Output as JSON:
{
  "blocking": [
    {
      "category": "completeness|clarity|consistency|scope",
      "description": "What's wrong",
      "suggestion": "How to fix it"
    }
  ],
  "advisory": [
    {
      "category": "risk|alternative|clarification|improvement",
      "description": "The concern",
      "suggestion": "Suggested action",
      "severity": "high|medium|low"
    }
  ]
}`;
}

/**
 * Build critique prompt for architecture phase.
 */
export function buildArchitectureCritiquePrompt(
  draft: string,
  features: FeaturesPhaseOutput
): string {
  const featureIds = features.features.map(f => f.id).join(', ');
  const acceptanceCriteria = features.features.flatMap(f =>
    f.acceptance_criteria.map(c => `[${f.id}] ${c}`)
  ).join('\n');

  return `You are reviewing an architecture design draft against feature requirements.

## Feature IDs to Support
${featureIds}

## Acceptance Criteria That Must Be Achievable
${acceptanceCriteria}

## Your Role

Critically analyze this architecture for:

1. **Feature Coverage**: Does the architecture support ALL features?
2. **Scalability**: Will it handle expected load?
3. **Security**: Are there security gaps or vulnerabilities?
4. **Technology Fit**: Are technology choices appropriate?
5. **Complexity**: Is it over-engineered or under-engineered?
6. **Maintainability**: Will it be maintainable long-term?
7. **Cost**: Are there cost implications not considered?

## Draft to Review

${draft}

## Output Format

For each issue found, categorize as:

**BLOCKING** (must fix before proceeding):
- Feature not achievable with this architecture
- Critical security vulnerability
- Fundamental scalability issue

**ADVISORY** (log for human review):
- Alternative technology suggestions
- Cost optimization opportunities
- Long-term maintenance concerns

Output as JSON:
{
  "blocking": [
    {
      "category": "coverage|security|scalability|technology",
      "description": "What's wrong",
      "affected_features": ["FEAT-001"],
      "suggestion": "How to fix it"
    }
  ],
  "advisory": [
    {
      "category": "risk|alternative|clarification|improvement",
      "description": "The concern",
      "affected_features": ["FEAT-002"],
      "suggestion": "Suggested action",
      "severity": "high|medium|low"
    }
  ]
}`;
}
