# Council Spec

AI-powered software specification and test plan generation using multi-agent consensus.

## Overview

Council Spec guides you through a structured process to transform project ideas into detailed technical specifications and comprehensive test plans. It uses a multi-agent council (powered by [agent-council](https://github.com/bladehstream/agent-council)) to analyze requirements from multiple perspectives.

**Final Deliverables:**
- `spec-final.json` + `spec-final.md` - Complete technical specification
- `test-plan-output.json` + `test-plan.md` - Comprehensive test plan

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                        SPEC WORKFLOW                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. INTERVIEW        Gather requirements conversationally       │
│        ↓             → state/interview-output.json              │
│                                                                 │
│  2. SPEC COUNCIL     Multi-agent analysis (MERGE mode)          │
│        ↓             All agent insights combined by chairman    │
│                      → state/spec-council-output.json           │
│                                                                 │
│  3. VALIDATION       Resolve ambiguities with human input       │
│        ↓             → state/decisions.json                     │
│                                                                 │
│  4. FINALIZE         Compile final specification                │
│        ↓             → state/spec-final.json                    │
│                                                                 │
│  5. TEST COUNCIL     Generate test plan (MERGE mode)            │
│        ↓             All agent ideas combined by chairman       │
│                      → state/test-plan-output.json              │
│                                                                 │
│  6. EXPORT           Convert to human-readable markdown         │
│                      → state/spec-final.md                      │
│                      → state/test-plan.md                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Phase 1: Interview

An AI assistant interviews you about your project:
- Problem statement and motivation
- Core functionality and priorities
- Users and actors
- Technical constraints
- Integration points
- Success criteria

### Phase 2: Spec Council (Merge Mode)

Multiple AI agents independently analyze your requirements using **merge mode**:

- **Stage 1**: Each agent (Claude, Gemini, Codex) produces their analysis
- **Stage 2**: **Skipped** - no ranking needed since all insights are valuable
- **Stage 3**: Two-pass chairman synthesis **merges ALL** unique insights:
  - **Pass 1**: Executive summary, ambiguities, consensus notes, implementation phases
  - **Pass 2**: Detailed specifications (architecture, data model, APIs, user flows, security, deployment)

**Why merge mode?** For specifications, we want ALL perspectives - each agent may identify architectural considerations, edge cases, or requirements that others miss.

### Phase 3: Validation

The council identifies ambiguities requiring human decision. You review each and provide decisions with rationale.

### Phase 4: Finalize

All inputs are compiled into a comprehensive specification (~100KB+):
- Architecture design
- Data model
- API contracts
- User flows
- Security considerations
- Deployment strategy
- Validated decisions

### Phase 5: Test Council (Merge Mode)

Generate a comprehensive test plan using **merge mode**:

- **Stage 1**: Each agent generates test cases independently
- **Stage 2**: **Skipped** - no ranking needed
- **Stage 3**: Two-pass chairman **merges ALL** unique test cases:
  - **Pass 1**: Categorize and deduplicate tests from all responders
  - **Pass 2**: Refine into structured test plan with priorities

**Why merge mode?** For test plans, we want ALL ideas - each model identifies unique edge cases, security concerns, and scenarios that others miss.

### Phase 6: Export

Convert JSON artifacts to human-readable markdown:
- `spec-final.json` → `spec-final.md`
- `test-plan-output.json` → `test-plan.md`

These are deterministic template-based conversions (no AI calls).

## Installation

```bash
git clone https://github.com/bladehstream/council-spec.git
cd council-spec
npm install
npm run build
```

### Prerequisites

- Node.js 18+
- At least 2 AI CLI tools installed and authenticated:
  - [Claude Code](https://github.com/anthropics/claude-code): `npm install -g @anthropic-ai/claude-code`
  - [Codex CLI](https://github.com/openai/codex): `npm install -g @openai/codex`
  - [Gemini CLI](https://github.com/google/gemini-cli): `npm install -g @google/gemini-cli`

The [agent-council](https://github.com/bladehstream/agent-council) dependency is installed automatically.

## Usage

See [QUICKSTART.md](QUICKSTART.md) for a complete walkthrough.

### Quick Commands

```bash
# Initialize a new project
npm run init my-project-name

# Run the spec council with a preset (merge mode)
COUNCIL_PRESET=merge-fast npm run council      # Quick iteration
COUNCIL_PRESET=merge-balanced npm run council  # Default quality (recommended)
COUNCIL_PRESET=merge-thorough npm run council  # Maximum quality

# Validate decisions
npm run validate status

# Generate final spec
npm run finalize

# Generate test plan (merge mode)
COUNCIL_PRESET=merge-fast npm run test-council
COUNCIL_PRESET=merge-balanced npm run test-council  # Recommended
COUNCIL_PRESET=merge-thorough npm run test-council

# Export to markdown
npm run export:spec   # Spec only
npm run export:tests  # Test plan only
npm run export:all    # Both
```

## Council Presets

**Always use `COUNCIL_PRESET`** to run the councils. This ensures two-pass chairman synthesis is properly configured.

### Spec Council Presets (Merge Mode)

Use for `npm run council` - ALL responses combined for comprehensive specifications.

| Preset | Stage 1 | Stage 2 | Chairman | Output Quality |
|--------|---------|---------|----------|----------------|
| `merge-fast` | 3x fast | *skipped* | default/fast | Outlines (fallback if Pass 2 fails) |
| `merge-balanced` | 3x default | *skipped* | heavy/default | Full detailed specs |
| `merge-thorough` | 3x heavy | *skipped* | heavy/heavy | Maximum detail |

### Test Council Presets (Merge Mode)

Use for `npm run test-council` - ALL responses combined for comprehensive coverage.

| Preset | Stage 1 | Stage 2 | Chairman | Output Quality |
|--------|---------|---------|----------|----------------|
| `merge-fast` | 3x fast | *skipped* | default/fast | Quick test ideas |
| `merge-balanced` | 3x default | *skipped* | default/default | Comprehensive tests |
| `merge-thorough` | 3x heavy | *skipped* | default/default | Maximum coverage |

### Two-Pass Chairman

The chairman runs twice to handle large output reliably:

1. **Pass 1 (Synthesis)**: Executive summary, ambiguities, consensus notes, implementation phases, section outlines
2. **Pass 2 (Detail)**: Architecture, data model, API contracts, user flows, security, deployment

If Pass 2 fails (common with `fast` preset), section outlines from Pass 1 are used as fallback.

### Override Individual Settings

You can override specific parts while keeping the preset base:

```bash
# Use fast preset but heavy chairman
COUNCIL_PRESET=fast COUNCIL_CHAIRMAN=claude:heavy npm run council

# Use balanced preset with longer timeout
COUNCIL_PRESET=balanced COUNCIL_TIMEOUT=600 npm run council

# Granular chairman control (different tiers per pass)
COUNCIL_PRESET=merge-thorough COUNCIL_CHAIRMAN=claude:heavy/default npm run test-council
```

**Chairman Format:**
- `provider:tier` - Same tier for both passes (e.g., `claude:heavy`)
- `provider:pass1tier/pass2tier` - Different tiers per pass (e.g., `gemini:heavy/default`)

This is useful when Pass 1 (synthesis/analysis) benefits from heavier reasoning, but Pass 2 (JSON formatting) needs speed and reliability.

## Configuration

The `config.json` provides defaults, but **presets override these**:

```json
{
  "council": {
    "responders": "3:default",
    "chairman": "gemini:heavy",
    "timeout_seconds": 420
  }
}
```

**Note:** The chairman defaults to `gemini:heavy` for largest context window (2M tokens). Fallback chain: `gemini:heavy` → `codex:heavy` → `claude:heavy`.

### Agent Tiers

| Tier | Claude | Gemini | Codex | Best For |
|------|--------|--------|-------|----------|
| `fast` | Haiku | Flash Lite | Mini | Quick iteration |
| `default` | Sonnet | Flash | Codex | Balanced |
| `heavy` | Opus | Pro | Max | Complex analysis |

## Project Structure

```
council-spec/
├── src/
│   ├── council.ts       # Spec council runner (merge mode)
│   ├── test-council.ts  # Test council runner (merge mode)
│   ├── finalize.ts      # Final spec compilation
│   ├── export-spec.ts   # Spec JSON → markdown conversion
│   ├── export-tests.ts  # Test plan JSON → markdown conversion
│   ├── markdown-utils.ts # Shared markdown formatting utilities
│   ├── validate.ts      # Validation helper
│   ├── init.ts          # Project initialization
│   ├── types.ts         # TypeScript interfaces
│   └── utils.ts         # Utility functions
├── state/
│   ├── conversations/   # Timestamped audit logs
│   ├── checkpoints/     # Pipeline checkpoints for resumption
│   └── *.json, *.md     # Workflow state files
├── schemas/             # JSON schemas for state files
├── prompts/
│   └── workflow.md      # Interview & validation instructions
├── config.json          # Council configuration
├── CLAUDE.md            # AI assistant operating constraints
└── README.md
```

## State Files

| File | Created By | Contents |
|------|-----------|----------|
| `interview-output.json` | Interview phase | Structured requirements |
| `spec-council-output.json` | Spec Council phase | Multi-agent analysis + spec sections |
| `decisions.json` | Validation phase | Human decisions on ambiguities |
| `spec-final.json` | Finalize phase | Complete specification (~100KB) |
| `spec-final.md` | Export phase | Human-readable specification |
| `test-plan-output.json` | Test Council phase | Comprehensive test plan |
| `test-plan.md` | Export phase | Human-readable test plan |

### Final Spec Structure

The `spec-final.json` contains:

```json
{
  "metadata": { "project_name": "...", "version": "1.0.0", ... },
  "validated_decisions": { ... },
  "problem_statement": { ... },
  "users_and_actors": [ ... ],
  "constraints": { ... },
  "core_functionality": [ ... ],
  "architecture": "...",      // ~14KB
  "data_model": "...",        // ~9KB
  "api_contracts": "...",     // ~11KB
  "user_flows": "...",        // ~15KB
  "security": "...",          // ~9KB
  "deployment": "..."         // ~15KB
}
```

## Checkpointing

The council phase supports checkpointing for resumption after interruption:

```bash
# Checkpoints are saved automatically to state/checkpoints/
# To clear and start fresh:
rm -f state/checkpoints/council-checkpoint.json
```

## Conversation Logging

Every workflow run creates an audit log:
```
state/conversations/2024-12-18_103045_my-project.log
```

Contains all interview Q&A, council execution details, validation decisions, and timestamps.

## Testing

```bash
npm run test           # All tests (79 tests)
npm run test:unit      # Unit tests (27 tests)
npm run test:integration  # Integration tests (20 tests)
npm run test:contract  # Contract tests (17 tests)
npm run test:smoke     # End-to-end smoke tests (15 tests)
npm run test:coverage  # With coverage report
```

**Test Coverage:**
- Unit tests: Utility functions, config loading, markdown formatting
- Integration tests: Council module with mocked agent-council
- Contract tests: Verify agent-council API exports and signatures
- Smoke tests: End-to-end workflow verification

## Related Projects

- [agent-council](https://github.com/bladehstream/agent-council) - Multi-model AI council engine with two-pass synthesis
