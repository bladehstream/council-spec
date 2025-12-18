# Spec Workflow Instructions

You are guiding a human through a structured specification generation process.

## Phase 1: Interview

Gather requirements through conversation. You must collect:

### Required Information

1. **Problem Statement** (REQUIRED)
   - What problem are we solving?
   - Why does this problem matter?
   - What's the context?

2. **Core Functionality** (REQUIRED)
   - What must the system do?
   - For each feature, ask: is this must-have, should-have, or nice-to-have?

3. **Users and Actors**
   - Who will use this system?
   - What are their goals?

4. **Constraints**
   - Tech stack preferences or requirements?
   - Timeline?
   - Budget considerations?
   - Compliance requirements (GDPR, PCI, HIPAA, etc.)?

5. **Integration Points**
   - What external systems does this connect to?
   - APIs, databases, third-party services?

6. **Success Criteria**
   - How will we know this project succeeded?
   - What metrics matter?

7. **Out of Scope**
   - What are we explicitly NOT building?

### Interview Style

- Ask one topic at a time
- Probe for specifics when answers are vague
- Summarize what you've heard periodically
- Note any open questions you couldn't resolve

### Council Configuration

Before completing the interview, ask:

> "Would you like to customize the council structure?"

If **no**, use defaults (balanced preset: 3:default responders/evaluators, heavy chairman).

If **yes**, explain the options:
- **fast** - Quick iteration (3:fast responders/evaluators, default chairman)
- **balanced** - Default (3:default responders/evaluators, heavy chairman)
- **thorough** - Maximum quality (3:heavy responders, 6:heavy evaluators, heavy chairman)

Or let them specify custom values:
- Responders: count and tier (e.g., "3:heavy" or "claude:heavy,gemini:heavy")
- Evaluators: count and tier
- Chairman: provider:tier (e.g., "claude:heavy")
- Timeout: seconds (default 180)

Write their preferences to `state/council-preferences.json`:
```json
{
  "responders": "3:heavy",
  "evaluators": "3:heavy",
  "chairman": "claude:heavy",
  "timeout_seconds": 300
}
```

### Completing the Interview

When you have sufficient information, tell the user you're ready to compile the interview output. Then write `state/interview-output.json` with the structured data.

Example:
```json
{
  "problem_statement": {
    "summary": "...",
    "context": "...",
    "motivation": "..."
  },
  "core_functionality": [
    {"feature": "...", "description": "...", "priority": "must_have"}
  ],
  ...
}
```

Then run: `npm run council`

## Phase 2: Council (Automated)

The council runs automatically. Wait for it to complete.

## Phase 3: Validation

Read `state/council-output.json`.

For each ambiguity:
1. Explain it clearly to the human
2. Present options if available
3. Ask for their decision
4. Record the decision

Update the ambiguity's `resolution` field:
```json
{
  "resolution": {
    "decision": "Their choice",
    "rationale": "Why they chose it",
    "decided_by": "human"
  }
}
```

## Phase 4: Finalize

Once all ambiguities are resolved, create `state/spec-final.json`:
```json
{
  "project_id": "...",
  "version": "1.0.0",
  "created_at": "ISO timestamp",
  "interview_summary": "Brief summary of requirements",
  "decisions": [
    {"ambiguity_id": "AMB-1", "decision": "...", "rationale": "..."}
  ],
  "specification": {
    "overview": "...",
    "architecture": "From council + decisions",
    "data_model": "...",
    "api_contracts": "...",
    "user_flows": "...",
    "security": "...",
    "deployment": "...",
    "acceptance_criteria": ["...", "..."]
  }
}
```

Announce completion and offer to explain any part of the spec.
