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
│  2. COUNCIL          Multi-agent analysis & synthesis           │
│        ↓             → state/council-output.json                │
│                                                                 │
│  3. VALIDATION       Resolve ambiguities with human input       │
│        ↓             → Updated council-output.json              │
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

Multiple AI agents independently analyze your requirements, then:
- **Stage 1**: Each agent produces their analysis
- **Stage 2**: Agents peer-review and rank each other's responses
- **Stage 3**: A chairman synthesizes the best insights

### Phase 3: Validation

The council identifies ambiguities, contradictions, and missing information. You review these and make decisions to resolve them.

### Phase 4: Finalize

All decisions are compiled into a final specification document covering:
- Architecture
- Data model
- API contracts
- User flows
- Security considerations
- Deployment strategy

## Installation

```bash
git clone https://github.com/bladehstream/council-spec.git
cd council-spec
npm install
npm run build
```

### Prerequisites

- Node.js 18+
- At least 2 AI CLI tools installed and authenticated (Claude Code, Codex CLI, or Gemini CLI)

The [agent-council](https://github.com/bladehstream/agent-council) dependency is installed automatically from GitHub.

## Usage

See [QUICKSTART.md](QUICKSTART.md) for a complete walkthrough.

### Quick Commands

```bash
# Initialize a new project
npm run init my-project-name

# Run the council phase (after interview)
npm run council
```

## Configuration

Edit `config.json` to customize the council:

```json
{
  "council": {
    "responders": "3:heavy",
    "evaluators": "3:heavy",
    "chairman": "claude:heavy",
    "timeout_seconds": 420
  }
}
```

### Agent Tiers

- `fast` - Quick responses, lower cost
- `default` - Balanced quality/speed
- `heavy` - Maximum quality, slower

### Examples

```json
// Fast iteration
{ "responders": "3:fast", "evaluators": "3:fast", "chairman": "claude:default" }

// Maximum quality
{ "responders": "3:heavy", "evaluators": "6:heavy", "chairman": "claude:heavy" }

// Explicit agents
{ "responders": "claude:heavy,gemini:heavy,codex:heavy" }
```

## Project Structure

```
council-spec/
├── src/
│   ├── council.ts      # Council runner (uses agent-council library)
│   ├── init.ts         # Project initialization
│   └── types.ts        # TypeScript interfaces
├── state/
│   ├── conversations/  # Timestamped audit logs
│   └── *.json          # Workflow state files
├── prompts/
│   └── workflow.md     # Interview & validation instructions
├── config.json         # Council configuration
├── CLAUDE.md           # AI assistant constraints
└── README.md
```

## State Files

| File | Created By | Contents |
|------|-----------|----------|
| `interview-output.json` | Interview phase | Structured requirements |
| `council-output.json` | Council phase | Multi-agent analysis |
| `spec-final.json` | Finalize phase | Complete specification |

## Conversation Logging

Every workflow run creates an audit log:
```
state/conversations/2024-12-18_103045_my-project.log
```

Contains all interview Q&A, council execution details, validation decisions, and final summary.

## Related Projects

- [agent-council](https://github.com/bladehstream/agent-council) - Multi-model AI council CLI
