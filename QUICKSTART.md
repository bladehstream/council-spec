# Quick Start Guide

Get from idea to specification and test plan in 6 phases.

## Prerequisites

1. **Node.js 18+** installed
2. At least 2 AI CLI tools installed and authenticated:
   - Claude Code: `npm install -g @anthropic-ai/claude-code` then `claude auth`
   - Codex CLI: `npm install -g @openai/codex` then `codex auth`
   - Gemini CLI: `npm install -g @google/gemini-cli` then `gemini auth`

## Setup

```bash
cd council-spec
npm install
npm run build
```

## Running the Workflow

### Step 1: Initialize Project

```bash
npm run init my-awesome-project
```

This creates:
- A new conversation log: `state/conversations/YYYY-MM-DD_HHMMSS_my-awesome-project.log`
- Clears any previous state files

### Step 2: Interview Phase

Start a conversation with an AI assistant (e.g., Claude) in this project directory. The assistant will follow `prompts/workflow.md` to interview you.

**What to expect:**
- Questions about what you're building
- Clarifications on requirements
- Discussion of constraints and priorities

**When complete:**
- The assistant writes `state/interview-output.json`
- You're ready for the council phase

### Step 3: Council Phase

```bash
COUNCIL_PRESET=merge-balanced npm run council
```

This runs the multi-agent council in **merge mode**:
1. **Stage 1**: Multiple agents analyze your requirements independently
2. **Stage 2**: Sectioned deduplication pre-consolidates content (enabled by default)
3. **Stage 3**: Chairman merges ALL unique insights from every agent

**Output:** `state/spec-council-output.json`

Progress is displayed in the terminal. Typical runtime: 3-6 minutes.

**Presets:**
- `merge-fast` - Quick iteration
- `merge-balanced` - Default quality (recommended)
- `merge-thorough` - Maximum detail

### Step 4: Validation Phase

The assistant reads `state/spec-council-output.json` and presents any ambiguities:

```
AMBIGUITY AMB-1: Authentication method not specified
Options:
  A) OAuth 2.0 with social providers
  B) Email/password with MFA
  C) SSO integration only

Which approach do you prefer?
```

Your decisions are recorded in the council output.

### Step 5: Finalize

The assistant compiles everything into `state/spec-final.json`:

```json
{
  "project_id": "my-awesome-project",
  "version": "1.0.0",
  "specification": {
    "overview": "...",
    "architecture": "...",
    "data_model": "...",
    "api_contracts": "...",
    "user_flows": "...",
    "security": "...",
    "deployment": "..."
  }
}
```

### Step 6: Test Council

Generate a comprehensive test plan from the finalized spec:

```bash
COUNCIL_PRESET=merge-balanced npm run test-council
```

This runs the test council in **merge mode**:
1. **Stage 1**: Multiple agents generate test cases independently
2. **Stage 2**: Sectioned deduplication consolidates by test category
3. **Stage 3**: Chairman merges ALL unique test cases

**Output:** `state/test-plan-output.json`

Categories covered:
- Unit tests
- Integration tests
- End-to-end tests
- Security tests
- Performance tests
- Edge cases

### Step 7: Export

Convert JSON artifacts to human-readable markdown:

```bash
npm run export:all
```

This creates:
- `state/spec-final.md` - Human-readable specification
- `state/test-plan.md` - Human-readable test plan

These are deterministic template-based conversions (no AI calls).

## Phased Workflow (Alternative)

For complex projects, use the phased workflow to separate features from architecture:

```bash
# Step 1: Interview (same as integrated)

# Step 2: Features phase - focus on WHAT
npm run phase -- --phase features --output state/features-output.json

# Step 3: Architecture phase - focus on HOW
npm run phase -- --phase architecture \
  --input state/features-output.json \
  --output state/architecture-output.json

# Step 4: Spec phase - synthesize both
npm run phase -- --phase spec \
  --input state/features-output.json \
  --input state/architecture-output.json \
  --output state/spec-final.json

# Step 5: Tests phase
npm run phase -- --phase tests \
  --input state/spec-final.json \
  --output state/test-plan-output.json

# Step 6: Export (same as integrated)
npm run export:all
```

### Critique Loop

Add `--critique` to enable adversarial critique that improves output quality:

```bash
npm run phase -- --phase features --critique
```

Add `--confirm` to require human approval before fixing each issue:

```bash
npm run phase -- --phase architecture --critique --confirm
```

## Resuming After Interruption

If your AI assistant session ends mid-workflow:

1. Check current state:
   ```bash
   ls -la state/
   ```

2. Resume based on what exists:

   **Integrated Workflow:**
   - Only `interview-output.json` → Run `npm run council`
   - Interview + council output → Continue validation phase
   - Interview + council + decisions → Run `npm run finalize`
   - spec-final.json exists → Run `npm run test-council`
   - spec-final + test-plan-output → Run `npm run export:all`
   - All files including markdown → Workflow complete

   **Phased Workflow:**
   - Only `interview-output.json` → Run features phase
   - Interview + features output → Run architecture phase
   - Interview + features + architecture → Run spec phase
   - spec-final.json exists → Run tests phase
   - All JSON files → Run `npm run export:all`

3. Read the latest conversation log for context:
   ```bash
   cat state/conversations/*.log
   ```

## Troubleshooting

### Council times out

Increase timeout in `config.json`:
```json
{
  "council": {
    "timeout_seconds": 420
  }
}
```

### No agents available

Ensure you have at least 2 AI CLI tools installed and authenticated:
```bash
which claude codex gemini
```

If the commands don't exist, install them from the Prerequisites section above.

### Type errors in interview output

The interview output must match the schema in `src/types.ts`. Common issues:
- `tech_stack` should be an array: `["React", "Node.js"]`
- `priority` must be: `"must_have"`, `"should_have"`, or `"nice_to_have"`

### Chairman parse errors

If the council fails with "Chairman did not return valid JSON", debug files are saved to `state/debug/`:
- `*_chairman-raw-response.txt` - Full chairman output (check for API errors)
- `*_pipeline-result.json` - Summary of all stage responses

Common causes:
- **Timeout**: Increase `timeout_seconds` (default 420s may not be enough for heavy tiers)
- **API error**: Check if the raw response starts with "Error from..."
- **Context too long**: Use faster tiers for responders to reduce Stage 1 output size

To disable verbose logging, set `DEBUG_LOGGING_ENABLED = false` in `src/council.ts`.

## Next Steps

After generating your spec and test plan:
1. Review `state/spec-final.md` and `state/test-plan.md`
2. Use the spec as input for implementation planning
3. Use the test plan to guide QA and testing efforts
4. Share with your team for feedback
5. Iterate by running the workflow again with refinements

For complex projects, consider using the phased workflow to catch feature-architecture conflicts early.
