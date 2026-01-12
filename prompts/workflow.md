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

### Workflow Choice

Before completing the interview, ask:

> "Would you prefer the **integrated workflow** (faster, single council) or the **phased workflow** (separates features from architecture, better for complex projects)?"

**Integrated Workflow** (default):
- Single spec council handles all analysis
- Faster for simpler projects
- Run with: `npm run council`

**Phased Workflow**:
- Separates features (WHAT) from architecture (HOW)
- Prevents architecture from constraining feature requests
- Better for complex projects
- Optional critique loop for quality

If they choose **phased workflow**, also ask about critique:

> "Would you like to enable the **critique loop**? This adds adversarial review that catches issues early, but takes longer."

### Council Configuration

Then ask:

> "Would you like to customize the council structure?"

If **no**, use defaults (merge-balanced preset: 3:default responders, gemini:heavy chairman).

If **yes**, explain the options:
- **merge-fast** - Quick iteration (3:fast responders, default/fast chairman)
- **merge-balanced** - Default (3:default responders, heavy/default chairman)
- **merge-thorough** - Maximum quality (3:heavy responders, heavy/heavy chairman)

Or let them specify custom values:
- Responders: count and tier (e.g., "3:heavy" or "claude:heavy,gemini:heavy")
- Chairman: provider:tier or provider:pass1tier/pass2tier (e.g., "gemini:heavy/default")
- Timeout: seconds (default 420)

**Note:** The council uses merge mode where ALL agent responses are combined. Stage 2 (evaluators) is skipped. The chairman defaults to `gemini:heavy` for the largest context window.

Write their preferences to `state/council-preferences.json`:
```json
{
  "responders": "3:default",
  "chairman": "gemini:heavy",
  "timeout_seconds": 420,
  "use_phased_workflow": false,
  "critique_enabled": false
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

Read `state/spec-council-output.json` or use the validation helper:

```bash
npm run validate status    # Check current state
npm run validate questions # List all questions to resolve
npm run validate template  # Generate decisions.json template
```

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

Once all ambiguities are resolved:

1. Write all decisions to `state/decisions.json`:
```json
{
  "decisions": [
    {
      "id": "minimum_ios_version",
      "question": "What is the minimum iOS version to support?",
      "decision": "iOS 16+",
      "rationale": "Neural Engine v2, modern APIs"
    },
    {
      "id": "bitrate_floor",
      "question": "What is the video bitrate floor?",
      "decision": 250,
      "rationale": "Minimum viable H.264 at 360p"
    }
  ],
  "validated_at": "2025-12-18T15:00:00Z"
}
```

2. Run the finalize command:
```bash
npm run finalize
```

This compiles the final specification from interview + council + decisions.

**IMPORTANT**: Do NOT manually write `state/spec-final.json`. Always use the finalize command to ensure consistent output format.

3. Announce completion and proceed to Test Council.

## Phase 5: Test Council

Generate a comprehensive test plan from the finalized specification:

```bash
COUNCIL_PRESET=merge-balanced npm run test-council
```

This runs automatically. Wait for it to complete (~3-5 minutes).

**Output:** `state/test-plan-output.json`

The test plan includes:
- Unit tests
- Integration tests
- End-to-end tests
- Security tests
- Performance tests
- Edge cases

Review the test plan with the user and ask if they want to adjust priorities or add specific test scenarios.

## Phase 6: Export

Convert JSON artifacts to human-readable markdown:

```bash
npm run export:all
```

This creates:
- `state/spec-final.md` - Human-readable specification
- `state/test-plan.md` - Human-readable test plan

These are deterministic template-based conversions (no AI calls).

Announce workflow completion and provide the user with paths to all final artifacts:
- `state/spec-final.json` / `state/spec-final.md`
- `state/test-plan-output.json` / `state/test-plan.md`

## Phased Workflow (Alternative)

If the user chose the phased workflow during interview:

### Features Phase

Run:
```bash
npm run phase -- --phase features --output state/features-output.json
```

With critique:
```bash
npm run phase -- --phase features --critique --output state/features-output.json
```

Review the features output with the user. This focuses on WHAT the system does:
- User stories (As a..., I want..., So that...)
- Acceptance criteria
- Feature priorities
- No architecture or technology choices

### Architecture Phase

Run:
```bash
npm run phase -- --phase architecture \
  --input state/features-output.json \
  --output state/architecture-output.json
```

With critique and human confirmation:
```bash
npm run phase -- --phase architecture --critique --confirm \
  --input state/features-output.json \
  --output state/architecture-output.json
```

Review the architecture output with the user. This focuses on HOW to implement:
- Component design
- Technology choices
- API contracts
- Data model
- Security architecture

### Spec Phase

Run:
```bash
npm run phase -- --phase spec \
  --input state/features-output.json \
  --input state/architecture-output.json \
  --output state/spec-final.json
```

This synthesizes features and architecture into the final specification.

### Tests Phase

Run:
```bash
npm run phase -- --phase tests \
  --input state/spec-final.json \
  --output state/test-plan-output.json
```

### Export Phase

Same as integrated workflow:
```bash
npm run export:all
```

### Advisory Concerns

If critique was enabled, non-blocking advisory concerns are saved to `*-advisory.json` files. Review these with the user:
- Alternative approaches worth considering
- Potential risks identified
- Clarifications that might improve the spec

These don't require immediate action but should be logged for future reference.
