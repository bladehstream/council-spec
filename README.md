# Council Spec

AI-powered software specification generation using multi-agent consensus.

## Overview

Council Spec guides you through a structured process to transform project ideas into detailed technical specifications. It uses a multi-agent council (powered by [agent-council](https://github.com/bladehstream/agent-council)) to analyze requirements from multiple perspectives and synthesize comprehensive specs.

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                        SPEC WORKFLOW                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. INTERVIEW        Gather requirements conversationally       │
│        ↓             → state/interview-output.json              │
│                                                                 │
│  2. COUNCIL          Multi-agent analysis & two-pass synthesis  │
│        ↓             → state/council-output.json                │
│                                                                 │
│  3. VALIDATION       Resolve ambiguities with human input       │
│        ↓             → state/decisions.json                     │
│                                                                 │
│  4. FINALIZE         Compile final specification                │
│                      → state/spec-final.json                    │
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

### Phase 2: Council

Multiple AI agents independently analyze your requirements using a three-stage pipeline:

- **Stage 1**: Each agent (Claude, Gemini, Codex) produces their analysis
- **Stage 2**: Agents peer-review and rank each other's responses
- **Stage 3**: Two-pass chairman synthesis:
  - **Pass 1**: Executive summary, ambiguities, consensus notes, implementation phases
  - **Pass 2**: Detailed specifications (architecture, data model, APIs, user flows, security, deployment)

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

# Run the council phase with a preset (REQUIRED)
COUNCIL_PRESET=fast npm run council      # Quick iteration
COUNCIL_PRESET=balanced npm run council  # Default quality (recommended)
COUNCIL_PRESET=thorough npm run council  # Maximum quality

# Validate decisions
npm run validate status

# Generate final spec
npm run finalize
```

## Council Presets

**Always use `COUNCIL_PRESET`** to run the council. This ensures two-pass chairman synthesis is properly configured.

| Preset | Stage 1 | Stage 2 | Chairman | Output Quality |
|--------|---------|---------|----------|----------------|
| `fast` | 3x fast | 3x fast | default/default | Outlines (fallback if Pass 2 fails) |
| `balanced` | 3x default | 3x default | heavy/default | Full detailed specs |
| `thorough` | 3x heavy | 6x heavy | heavy/heavy | Maximum detail |

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
```

## Configuration

The `config.json` provides defaults, but **presets override these**:

```json
{
  "council": {
    "responders": "3:default",
    "evaluators": "3:default",
    "chairman": "claude:heavy",
    "timeout_seconds": 420
  }
}
```

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
│   ├── council.ts      # Council runner with two-pass support
│   ├── finalize.ts     # Final spec compilation
│   ├── validate.ts     # Validation helper
│   ├── init.ts         # Project initialization
│   ├── types.ts        # TypeScript interfaces
│   └── utils.ts        # Utility functions
├── state/
│   ├── conversations/  # Timestamped audit logs
│   ├── checkpoints/    # Pipeline checkpoints for resumption
│   └── *.json          # Workflow state files
├── schemas/            # JSON schemas for state files
├── prompts/
│   └── workflow.md     # Interview & validation instructions
├── config.json         # Council configuration
├── CLAUDE.md           # AI assistant operating constraints
└── README.md
```

## State Files

| File | Created By | Contents |
|------|-----------|----------|
| `interview-output.json` | Interview phase | Structured requirements |
| `council-output.json` | Council phase | Multi-agent analysis + spec sections |
| `decisions.json` | Validation phase | Human decisions on ambiguities |
| `spec-final.json` | Finalize phase | Complete specification (~100KB) |

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
npm run test           # All tests
npm run test:unit      # Unit tests only
npm run test:smoke     # End-to-end smoke tests
npm run test:coverage  # With coverage report
```

## Related Projects

- [agent-council](https://github.com/bladehstream/agent-council) - Multi-model AI council engine with two-pass synthesis
