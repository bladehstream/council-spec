# Spec Workflow

This project generates complete software specifications and test plans through AI-assisted requirements gathering and multi-agent consensus.

**Final Artifacts:**
- `state/spec-final.json` + `state/spec-final.md` - Complete technical specification
- `state/test-plan-output.json` + `state/test-plan.md` - Comprehensive test plan

## CRITICAL: Operating Constraints

**DO NOT modify any code in this project.** Your role is strictly limited to:

### Allowed Actions
- **Create/modify files in `state/`**:
  - `state/interview-output.json` - Interview results
  - `state/spec-council-output.json` - Spec council results (created by `npm run council` or `npm run phase`)
  - `state/phase-features-output.json` - Features phase output (created by `npm run phase`)
  - `state/phase-architecture-output.json` - Architecture phase output (created by `npm run phase`)
  - `state/*.advisory.md` - Advisory concerns from critique (created by `npm run phase` with `--critique`)
  - `state/decisions.json` - Validation decisions (see schemas/decisions.json)
  - `state/spec-final.json` - Final specification (created by `npm run finalize`)
  - `state/spec-final.md` - Human-readable spec (created by `npm run export:spec`)
  - `state/test-plan-output.json` - Test plan (created by `npm run test-council`)
  - `state/test-plan.md` - Human-readable test plan (created by `npm run export:tests`)
  - `state/council-preferences.json` - User's council configuration preferences
  - `state/conversations/*.log` - Conversation logs
- **Run commands**:
  - `npm run init <project-id>` - Initialize a new project
  - `npm run council` - Launch the spec council (merge mode, integrated workflow)
  - `npm run phase -- [options]` - Launch phased workflow (features → architecture → spec)
  - `npm run validate [command]` - Validation helper (see below)
  - `npm run finalize` - Compile final specification with feature manifest
  - `npm run test-council` - Generate test plan with feature traceability
  - `npm run export:spec` - Export spec-final.json to markdown
  - `npm run export:tests` - Export test-plan-output.json to markdown
  - `npm run export:all` - Export both spec and test plan to markdown
  - `npm run traceability [command]` - Query feature-to-test relationships (see below)
- **Read files** for context (config.json, prompts/workflow.md, existing state files)

### Prohibited Actions
- **DO NOT** modify any `.ts`, `.js`, `.json` (except state files), or `.md` files
- **DO NOT** edit `src/`, `dist/`, `config.json`, `package.json`, or `tsconfig.json`
- **DO NOT** install, update, or remove npm packages
- **DO NOT** modify `prompts/workflow.md` or this `CLAUDE.md` file
- **DO NOT** run `npm run build` or any build commands
- **DO NOT** modify your own operating environment in any way

If you encounter errors or bugs in the workflow code, **report them to the user** and ask them to fix the code manually. Do not attempt repairs yourself.

---

## Quick Start
```bash
npm install
npm run build
```

Then start the workflow by interviewing the user.

## Workflow Phases

### 1. Interview
Follow `prompts/workflow.md`. Gather requirements conversationally, then write `state/interview-output.json`.

### 2. Spec Council (Merge Mode)
Run with a preset (see Runtime Configuration below for options):
```bash
COUNCIL_PRESET=merge-fast npm run council      # Quick iteration
COUNCIL_PRESET=merge-balanced npm run council  # Default quality
COUNCIL_PRESET=merge-thorough npm run council  # Maximum quality
```

**Always use `COUNCIL_PRESET`** - this ensures two-pass chairman synthesis is configured correctly.

This uses **merge mode** where ALL agent responses are combined for comprehensive specifications:
- **Stage 1 (Responders)**: Multiple agents analyze requirements independently
- **Stage 2 (Deduplication)**: Sectioned deduplication pre-consolidates content (enabled by default)
- **Stage 3 (Chairman)**: Two-pass synthesis merges all unique insights
  - Pass 1: Executive summary, ambiguities, consensus notes (gemini:heavy default for large context)
  - Pass 2: Detailed specification sections (architecture, data model, APIs, etc.)

**Why merge mode for specs?** Unlike ranking (compete mode) which discards non-winning responses, merge mode preserves ALL unique insights from every agent. This produces more comprehensive specifications at the cost of requiring a chairman with a large context window.

**Sectioned Deduplication (Stage 2 - Default)**

Three evaluators run in parallel to pre-consolidate Stage 1 outputs before the chairman:
- **Evaluator 1**: Architecture + Data Model
- **Evaluator 2**: API Contracts + User Flows
- **Evaluator 3**: Security + Deployment

Each evaluator deduplicates their sections, flags conflicts, and notes unique insights. The chairman then receives consolidated input instead of raw Stage 1 responses.

To skip deduplication (not recommended): `COUNCIL_SKIP_DEDUP=true`

**Chairman defaults to `gemini:heavy`** for largest context window. Fallback chain: `gemini:heavy → codex:heavy → claude:heavy → fail`.

Output goes to `state/spec-council-output.json`.

### 2b. Phased Workflow (Alternative)

For complex or enterprise projects, use the phased workflow to separate feature gathering from architecture design:

```bash
# Run each phase separately with critique on high-stakes decisions
npm run phase -- --phase features --output state/features.json
npm run phase -- --phase architecture --input state/features.json --critique --confirm
npm run phase -- --phase spec --input state/features.json --input state/architecture.json

# Or run all phases sequentially
npm run phase -- --phase all --critique
```

**Why separate features from architecture?**

When features and architecture are gathered together:
- Architecture can constrain features: "Real-time sync is hard, so let's not ask for it"
- Features can assume architecture: "We need a WebSocket server" (that's architecture, not a feature)

Separating them ensures:
- Features describe WHAT the system does from the user's perspective
- Architecture describes HOW to achieve those features

**Phase Details:**

1. **Features Phase**: Extracts feature requirements, user stories, and acceptance criteria. Explicitly excludes technology choices or implementation details.
   - Output: `state/phase-features-output.json`

2. **Architecture Phase**: Designs system architecture to support the features. References specific features when justifying technology decisions.
   - Input: Features output
   - Output: `state/phase-architecture-output.json`

3. **Spec Phase**: Synthesizes features and architecture into a detailed specification with traceability.
   - Input: Features + Architecture outputs
   - Output: `state/spec-council-output.json` (same format as integrated workflow)

**Critique Loop Integration:**

Use `--critique` to enable adversarial review after each phase:
- BLOCKING critiques are auto-fixed before proceeding
- ADVISORY critiques are logged to `*.advisory.md` for human review

Use `--confirm` (requires `--critique`) to pause before applying blocking fixes.

**When to use which workflow:**

| Scenario | Recommended Workflow |
|----------|---------------------|
| MVP/Prototype | Integrated (`npm run council`) |
| Enterprise system | Phased with critique |
| Regulated industry | Phased with critique + confirm |
| Quick iteration | Integrated |
| New team unfamiliar with domain | Phased (clearer separation) |

**Per-phase configuration in config.json:**

```json
{
  "phases": {
    "features": { "critique": false },
    "architecture": { "critique": true, "confirm": true },
    "spec": { "critique": true, "confirm": false },
    "tests": { "critique": false }
  }
}
```

### 3. Validation
Review council output. Present ambiguities to user. Record decisions in `state/decisions.json`:

```json
{
  "decisions": [
    {
      "id": "minimum_ios_version",
      "question": "What is the minimum iOS version to support?",
      "decision": "iOS 16+",
      "rationale": "Neural Engine v2, modern AVFoundation APIs"
    }
  ],
  "validated_at": "2025-12-18T15:00:00Z"
}
```

See `schemas/decisions.json` for full schema.

**Validation Helper Commands:**
```bash
npm run validate status    # Show validation status (default)
npm run validate template  # Generate decisions.json template
npm run validate questions # List all open questions
npm run validate check     # Validate decisions.json (exit code for CI)
```

### 4. Finalize
Run:
```bash
npm run finalize
```

This compiles `state/spec-final.json` from:
- `state/interview-output.json` (requirements)
- `state/spec-council-output.json` (analysis)
- `state/decisions.json` (human decisions)

**Feature Manifest:** Finalize also creates a `feature_manifest` in spec-final.json with stable feature IDs (FEAT-001, FEAT-002, etc.) for each feature. These IDs enable traceability between features and tests.

**Do NOT manually write spec-final.json** - always use the finalize command.

### 5. Test Council (Merge Mode)
Generate a comprehensive test plan from the finalized spec:
```bash
COUNCIL_PRESET=merge-fast npm run test-council      # Quick iteration
COUNCIL_PRESET=merge-balanced npm run test-council  # Default quality
COUNCIL_PRESET=merge-thorough npm run test-council  # Maximum quality

# Resume from existing Stage 1 (skip responders, run chairman only)
RESUME_STAGE1=true COUNCIL_CHAIRMAN=gemini:default npm run test-council
```

This uses **merge mode** where ALL responses are combined (not ranked):
- **Stage 1 (Responders)**: Multiple agents generate test cases with `validates_features` linking to feature IDs
- **Stage 2 (Deduplication)**: Sectioned deduplication pre-consolidates content (enabled by default)
- **Stage 3 (Chairman)**: Two-pass synthesis merges all unique test cases
  - Pass 1: Categorize and deduplicate tests, union-merge feature refs
  - Pass 2: Refine into structured test plan with priorities
- **Stage 4 (Traceability)**: Writes `validated_by_tests` back to spec-final.json for each feature

**Why merge mode for tests?** Unlike specifications where we want the BEST approach, test plans benefit from diverse perspectives. Each model may identify unique edge cases, security concerns, or test scenarios that others miss.

**Feature Traceability:** Each test includes a `validates_features` array linking to feature IDs. When tests are merged, feature refs are unioned (combined). After generation, test-council updates spec-final.json with `validated_by_tests` per feature, creating bidirectional traceability.

**Sectioned Deduplication with Gap Analysis (Stage 2 - Default)**

Three evaluators run in parallel to pre-consolidate test cases by category:
- **Evaluator 1**: unit + integration (receives must_have features from spec)
- **Evaluator 2**: e2e + security (receives user_flows + security requirements)
- **Evaluator 3**: performance + edge_cases (receives performance requirements)

Each evaluator:
1. Receives relevant spec features from `spec-final.json`
2. Deduplicates only truly identical tests (same scenario, methodology, outcome)
3. Checks coverage against spec requirements
4. Outputs `===GAP_FLAGS===` section listing any missing coverage

The chairman then receives consolidated input with `[COVERAGE_GAP]` markers and enforces minimum test counts:
- Security: 6+ tests (SSRF, XSS, injection, prompt injection, rate limiting, input validation)
- E2E: 4+ tests
- Unit: 8+ tests
- Integration: 4+ tests
- Performance: 3+ tests
- Edge cases: 4+ tests

**Multi-tier responder example** (for maximum diversity):
```bash
COUNCIL_RESPONDERS='claude:default,gemini:default,codex:default,claude:heavy,gemini:heavy' \
TEST_COUNCIL_DEDUP_EVALUATORS='3:default' \
COUNCIL_CHAIRMAN='gemini:heavy/default' \
npm run test-council
```

To skip deduplication: `TEST_COUNCIL_SKIP_DEDUP=true`
To override evaluator tier: `TEST_COUNCIL_DEDUP_EVALUATORS=3:fast`

Output goes to `state/test-plan-output.json`.

### 6. Export
Generate human-readable markdown from the JSON artifacts:
```bash
npm run export:spec   # Creates state/spec-final.md
npm run export:tests  # Creates state/test-plan.md
npm run export:all    # Both
```

These are deterministic template-based conversions (no AI calls). Run after finalize and test-council to produce the final deliverables.

## Schemas

JSON schemas for state files are in `schemas/`:
- `schemas/interview-output.json` - Interview output structure
- `schemas/decisions.json` - Validation decisions structure

Use these schemas as reference when writing state files. They document required fields, types, and provide examples.

## Configuration

Edit `config.json` to change:
- Interview/validation model (default: claude-opus-4-5-20250514)
- Council agent counts and tiers
- Timeout settings

### Council Config Examples
```json
// Fast iteration (merge mode - evaluators ignored)
"council": {
  "responders": "3:fast",
  "evaluators": "0:default",
  "chairman": "gemini:heavy"
}

// Maximum quality (merge mode)
"council": {
  "responders": "3:heavy",
  "evaluators": "0:default",
  "chairman": "gemini:heavy"
}

// Explicit agent selection
"council": {
  "responders": "claude:heavy,gemini:heavy,codex:heavy",
  "evaluators": "0:default",
  "chairman": "gemini:heavy/default"
}
```

**Note:** In merge mode, evaluators are not used (Stage 2 is skipped). The `evaluators` config is ignored but kept for backward compatibility.

### Runtime Configuration

During the interview, ask: **"Would you like to customize the council structure?"**

If yes, explain the available options and write preferences to `state/council-preferences.json`:

```json
{
  "responders": "3:default",
  "chairman": "gemini:heavy",
  "timeout_seconds": 420
}
```

**Presets (from agent-council):**

*Merge Mode (for both Spec Council and Test Council):*
- `merge-fast` - 3:fast responders, no evaluators, default/fast chairman (quick iteration)
- `merge-balanced` - 3:default responders, no evaluators, heavy/default chairman (default)
- `merge-thorough` - 3:heavy responders, no evaluators, heavy/heavy chairman (maximum quality)

**Note:** Both spec council and test council now use merge mode to preserve all agent insights. The chairman defaults to `gemini:heavy` for largest context window.

All presets use two-pass chairman synthesis for reliable large output generation.

**Environment Variables:**

**IMPORTANT: Always use `COUNCIL_PRESET` to run the council.** This ensures two-pass chairman synthesis is properly configured. Individual env vars (COUNCIL_RESPONDERS, etc.) do NOT inherit two-pass config and will result in missing spec sections.

```bash
# RECOMMENDED: Use a merge preset (inherits ALL settings including two-pass)
COUNCIL_PRESET=merge-fast npm run council      # Quick iteration
COUNCIL_PRESET=merge-balanced npm run council  # Default quality
COUNCIL_PRESET=merge-thorough npm run council  # Maximum quality

# Override specific parts while keeping preset base
COUNCIL_PRESET=merge-fast COUNCIL_CHAIRMAN=claude:heavy npm run council

# Granular chairman control (pass1tier/pass2tier)
COUNCIL_PRESET=merge-thorough COUNCIL_CHAIRMAN=gemini:heavy/default npm run council
# Pass 1 uses heavy (synthesis), Pass 2 uses default (JSON formatting)

# Skip sectioned deduplication (not recommended)
COUNCIL_SKIP_DEDUP=true COUNCIL_PRESET=merge-balanced npm run council
# Override deduplication evaluator tier (default: 3:default)
COUNCIL_DEDUP_EVALUATORS=3:fast npm run council
```

**Chairman Format:**
- `provider:tier` - Use same tier for both passes (e.g., `claude:heavy`)
- `provider:pass1tier/pass2tier` - Different tiers per pass (e.g., `gemini:heavy/default`)

**DO NOT use individual env vars without COUNCIL_PRESET:**
```bash
# BAD - loses two-pass config and merge mode settings!
COUNCIL_RESPONDERS=3:fast npm run council
```

**Priority order:**
1. `COUNCIL_PRESET` env var - **USE THIS** (inherits all settings from agent-council)
2. Individual env vars - only for overriding specific parts of a preset
3. `state/council-preferences.json`
4. `config.json` (lowest)

## Resuming After Context Reset

Check state:
```bash
ls -la state/
```

**Integrated Workflow:**
- Only `interview-output.json` exists → Run `npm run council`
- Interview + council exist → Continue validation, then `npm run finalize`
- Interview + council + decisions exist → Run `npm run finalize`
- spec-final.json exists → Run `npm run test-council`
- spec-final.json + test-plan-output.json exist → Run `npm run export:all`
- All JSON + markdown files exist → Workflow complete

**Phased Workflow:**
- Only `interview-output.json` exists → Run `npm run phase -- --phase features`
- Interview + features exist → Run `npm run phase -- --phase architecture --input state/phase-features-output.json`
- Interview + features + architecture exist → Run `npm run phase -- --phase spec --input state/phase-features-output.json --input state/phase-architecture-output.json`
- spec-council-output.json exists → Continue validation, then `npm run finalize`

## Conversation Logging

Log all exchanges to a single file per workflow run:
```
state/conversations/YYYY-MM-DD_HHMMSS_<project-id>.log
```

Created automatically by `npm run init`. All phases append to the same file.

Format:
```
================================================================================
SPEC WORKFLOW LOG
Project: <project-id>
Started: <timestamp>
================================================================================

--- PHASE: INTERVIEW ---
[TIMESTAMP]

[USER]
Their message

[ASSISTANT]
Your response

--- PHASE: SPEC COUNCIL (merge mode) ---
[TIMESTAMP]

Config:
  Mode: merge
  Preset: merge-balanced
  Responders: 3:default
  Stage 2: Sectioned deduplication (3:default)
  Chairman: gemini:heavy
  Fallback Chain: codex:heavy → claude:heavy → fail

[TIMESTAMP]
Spec council complete (merge mode). Ambiguities found: 3

--- PHASE: VALIDATION ---
[TIMESTAMP]

[USER]
...

--- PHASE: FINALIZE ---
[TIMESTAMP]

Final spec written to state/spec-final.json

--- PHASE: TEST COUNCIL (merge mode) ---
[TIMESTAMP]

Config:
  Preset: merge-balanced
  Responders: 3:default
  Chairman: claude:heavy

[TIMESTAMP]
Test council complete. Tests generated: 42

--- PHASE: EXPORT ---
[TIMESTAMP]

Exported: state/spec-final.md (12.3 KB)
Exported: state/test-plan.md (8.7 KB)

--- PHASE: COMPLETE ---
[TIMESTAMP]

Workflow complete. Final artifacts:
  - state/spec-final.json
  - state/spec-final.md
  - state/test-plan-output.json
  - state/test-plan.md
```

Conversation logs are **preserved** across `npm run init` - they provide a complete audit trail across multiple project iterations. If context resets, find the most recent log file and continue from where it left off.

## Starting Fresh
```bash
npm run init my-project-name
```
