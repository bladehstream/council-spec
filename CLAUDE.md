# Spec Workflow

This project generates software specifications through AI-assisted requirements gathering and multi-agent consensus.

## CRITICAL: Operating Constraints

**DO NOT modify any code in this project.** Your role is strictly limited to:

### Allowed Actions
- **Create/modify files in `state/`**:
  - `state/interview-output.json` - Interview results
  - `state/council-output.json` - Council results (created by `npm run council`)
  - `state/decisions.json` - Validation decisions (see schemas/decisions.json)
  - `state/spec-final.json` - Final specification (created by `npm run finalize`)
  - `state/council-preferences.json` - User's council configuration preferences
  - `state/conversations/*.log` - Conversation logs
- **Run commands**:
  - `npm run init <project-id>` - Initialize a new project
  - `npm run council` - Launch the agent council
  - `npm run validate [command]` - Validation helper (see below)
  - `npm run finalize` - Compile final specification from interview + council + decisions
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

### 2. Council
Run:
```bash
npm run council
```

This invokes agent-council with the configuration in `config.json`:
- **Responders**: Stage 1 agents (e.g., "3:heavy" = 3 agents at heavy tier)
- **Evaluators**: Stage 2 peer review agents
- **Chairman**: Final synthesis agent

Output goes to `state/council-output.json`.

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
- `state/council-output.json` (analysis)
- `state/decisions.json` (human decisions)

**Do NOT manually write spec-final.json** - always use the finalize command.

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
// Fast iteration
"council": {
  "responders": "3:fast",
  "evaluators": "3:fast",
  "chairman": "gemini:default"
}

// Maximum quality
"council": {
  "responders": "3:heavy",
  "evaluators": "6:heavy",
  "chairman": "claude:heavy"
}

// Explicit agent selection
"council": {
  "responders": "claude:heavy,gemini:heavy,codex:heavy",
  "evaluators": "claude:default,gemini:default",
  "chairman": "claude:heavy"
}
```

### Runtime Configuration

During the interview, ask: **"Would you like to customize the council structure?"**

If yes, explain the available options and write preferences to `state/council-preferences.json`:

```json
{
  "responders": "3:heavy",
  "evaluators": "3:heavy",
  "chairman": "claude:heavy",
  "timeout_seconds": 300
}
```

**Presets:**
- `fast` - 3:fast responders, 3:fast evaluators, default chairman (quick iteration)
- `balanced` - 3:default responders, 3:default evaluators, heavy chairman (default)
- `thorough` - 3:heavy responders, 6:heavy evaluators, heavy chairman (maximum quality)

**Environment Variables (highest priority):**
```bash
COUNCIL_RESPONDERS=3:heavy npm run council
COUNCIL_EVALUATORS=6:heavy npm run council
COUNCIL_CHAIRMAN=claude:heavy npm run council
COUNCIL_TIMEOUT=300 npm run council
```

**Priority order:**
1. Environment variables (highest)
2. `state/council-preferences.json`
3. `config.json` (lowest)

## Resuming After Context Reset

Check state:
```bash
ls -la state/
```

- Only `interview-output.json` exists → Run `npm run council`
- Both interview + council → Continue validation
- All three files → Workflow complete

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

--- PHASE: COUNCIL ---
[TIMESTAMP]

Config:
  Responders: 3:heavy
  Evaluators: 3:heavy
  Chairman: claude:heavy

[TIMESTAMP]
Council complete. Ambiguities found: 3

--- PHASE: VALIDATION ---
[TIMESTAMP]

[USER]
...

--- PHASE: COMPLETE ---
[TIMESTAMP]

Final spec written to state/spec-final.json
```

Conversation logs are **preserved** across `npm run init` - they provide a complete audit trail across multiple project iterations. If context resets, find the most recent log file and continue from where it left off.

## Starting Fresh
```bash
npm run init my-project-name
```
