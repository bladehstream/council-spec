# Quick Start Guide

Get from idea to specification in 4 phases.

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
npm run council
```

This runs the multi-agent council:
1. **Stage 1**: Multiple agents analyze your requirements independently
2. **Stage 2**: Agents peer-review each other's responses
3. **Stage 3**: Chairman synthesizes the best insights

**Output:** `state/council-output.json`

Progress is displayed in the terminal. Typical runtime: 2-5 minutes.

### Step 4: Validation Phase

The assistant reads `state/council-output.json` and presents any ambiguities:

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

## Resuming After Interruption

If your AI assistant session ends mid-workflow:

1. Check current state:
   ```bash
   ls -la state/
   ```

2. Resume based on what exists:
   - Only `interview-output.json` → Run `npm run council`
   - Both interview + council output → Continue validation phase
   - All three files → Workflow complete

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

After generating your spec:
1. Review `state/spec-final.json`
2. Use it as input for implementation planning
3. Share with your team for feedback
4. Iterate by running the workflow again with refinements
