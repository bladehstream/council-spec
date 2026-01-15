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
│                    INTEGRATED WORKFLOW                          │
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

┌─────────────────────────────────────────────────────────────────┐
│                     PHASED WORKFLOW (Alternative)               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. INTERVIEW        Gather requirements conversationally       │
│        ↓             → state/interview-output.json              │
│                                                                 │
│  2. FEATURES         WHAT the system does (user perspective)    │
│        ↓             User stories, acceptance criteria only     │
│                      → state/features-output.json               │
│                                                                 │
│  3. ARCHITECTURE     HOW to implement (technical design)        │
│        ↓             Components, APIs, data model               │
│                      → state/architecture-output.json           │
│                                                                 │
│  4. SPEC             Synthesize features + architecture         │
│        ↓             → state/spec-final.json                    │
│                                                                 │
│  5. TESTS            Generate test plan from spec               │
│        ↓             → state/test-plan-output.json              │
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
- **Stage 2**: Sectioned deduplication pre-consolidates content (enabled by default)
- **Stage 3**: Two-pass chairman synthesis **merges ALL** unique insights:
  - **Pass 1**: Executive summary, ambiguities, consensus notes, implementation phases
  - **Pass 2**: Detailed specifications (architecture, data model, APIs, user flows, security, deployment)

**Why merge mode?** For specifications, we want ALL perspectives - each agent may identify architectural considerations, edge cases, or requirements that others miss.

**Sectioned Deduplication (default):** Three evaluators run in parallel, each handling 2 sections (Architecture+Data Model, APIs+User Flows, Security+Deployment). They flag conflicts and note unique insights for the chairman to resolve. To skip (not recommended): `COUNCIL_SKIP_DEDUP=true`

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
- **Feature manifest** with stable IDs (FEAT-001, FEAT-002, etc.) for traceability

### Phase 5: Test Council (Merge Mode)

Generate a comprehensive test plan using **merge mode**:

- **Stage 1**: Each agent generates test cases with `validates_features` linking to feature IDs
- **Stage 2**: Sectioned deduplication pre-consolidates content (enabled by default)
- **Stage 3**: Two-pass chairman **merges ALL** unique test cases (union of feature refs)
  - **Pass 1**: Categorize and deduplicate tests from all responders
  - **Pass 2**: Refine into structured test plan with priorities
- **Stage 4**: Write `validated_by_tests` back to spec-final.json for bidirectional traceability

**Why merge mode?** For test plans, we want ALL ideas - each model identifies unique edge cases, security concerns, and scenarios that others miss.

**Feature Traceability:** Every test links to features it validates. After test-council completes, `spec-final.json` is updated with reverse mappings (`validated_by_tests` per feature).

### Phase 6: Export

Convert JSON artifacts to human-readable markdown:
- `spec-final.json` → `spec-final.md`
- `test-plan-output.json` → `test-plan.md`

These are deterministic template-based conversions (no AI calls).

## Phased Workflow (Alternative)

The phased workflow separates **features** (WHAT) from **architecture** (HOW) to prevent:
- Architecture constraining features: "Real-time sync is hard, so let's not ask for it"
- Features assuming architecture: "We need a WebSocket server" (that's architecture, not a feature)

### Why Use Phased Workflow?

| Integrated Workflow | Phased Workflow |
|---------------------|-----------------|
| Faster (fewer steps) | More thorough (explicit separation) |
| Good for small projects | Better for complex projects |
| Single council handles all | Each phase has focused prompts |
| May miss feature-architecture conflicts | Catches conflicts early |

### Phased Workflow Steps

```bash
# 1. Interview (same as integrated)
# Write state/interview-output.json

# 2. Features phase - focus on WHAT
npm run phase -- --phase features --output state/features-output.json

# 3. Architecture phase - focus on HOW
npm run phase -- --phase architecture \
  --input state/interview-output.json \
  --input state/features-output.json \
  --output state/architecture-output.json

# 4. Spec phase - synthesize both
npm run phase -- --phase spec \
  --input state/interview-output.json \
  --input state/features-output.json \
  --input state/architecture-output.json \
  --output state/spec-final.json

# 5. Tests phase
npm run phase -- --phase tests \
  --input state/spec-final.json \
  --output state/test-plan-output.json

# 6. Export (same as integrated)
npm run export:all
```

### Critique Loop (Optional)

Enable adversarial critique to improve output quality:

```bash
npm run phase -- --phase features --critique --output state/features-output.json
```

With `--critique`:
1. **Draft**: Council generates initial output
2. **Critique**: Responders identify blocking issues and advisory concerns
3. **Resolve**: Chairman fixes blocking issues automatically
4. **Advisory**: Non-blocking concerns logged for human review

Add `--confirm` to require human approval before fixing each blocking issue:

```bash
npm run phase -- --phase architecture --critique --confirm \
  --input state/features-output.json \
  --output state/architecture-output.json
```

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

# === INTEGRATED WORKFLOW ===

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

# Feature-to-test traceability
npm run traceability                     # Summary: coverage %, gaps
npm run traceability feature FEAT-001    # List tests for a feature
npm run traceability test UNIT-001       # List features a test validates
npm run traceability gaps                # List features with no tests
npm run traceability check               # CI: exit 1 if must_have features lack tests

# === PHASED WORKFLOW ===

# Run individual phases (see "Phased Workflow" section for details)
npm run phase -- --phase features --output state/features-output.json
npm run phase -- --phase architecture --input state/features-output.json
npm run phase -- --phase spec --input state/features-output.json --input state/architecture-output.json
npm run phase -- --phase tests --input state/spec-final.json

# With critique loop
npm run phase -- --phase features --critique
npm run phase -- --phase architecture --critique --confirm  # Human confirmation
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

## Feature-to-Test Traceability

Council Spec provides bidirectional traceability between features and tests:

```
┌─────────────────────────────────────────────────────────────────────┐
│                     TRACEABILITY DATA FLOW                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. FINALIZE                                                        │
│     spec-final.json gets feature_manifest with stable IDs:         │
│     { id: "FEAT-001", name: "User Authentication", priority: ... } │
│                                                                     │
│  2. TEST-COUNCIL (Stage 1)                                          │
│     Responders generate tests with validates_features:             │
│     { id: "UNIT-001", validates_features: ["FEAT-001", "FEAT-002"] }│
│                                                                     │
│  3. TEST-COUNCIL (Stage 3)                                          │
│     Chairman merges tests → UNION of feature refs:                 │
│     Test A [FEAT-001] + Test B [FEAT-002] → Merged [FEAT-001,002] │
│                                                                     │
│  4. TEST-COUNCIL (Stage 4)                                          │
│     Write validated_by_tests back to spec-final.json:              │
│     FEAT-001: validated_by_tests: ["UNIT-001", "INT-003", ...]     │
│                                                                     │
│  Result: Bidirectional links in both artifacts                      │
│     spec-final.json: feature → tests                                │
│     test-plan-output.json: test → features                          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Traceability CLI

Query feature-test relationships:

```bash
# Summary report with coverage percentage
npm run traceability

# Output:
# Feature-to-Test Traceability Report
# ====================================
# Coverage: 8/10 features (80%)
#
# ✓ FEAT-001: User Authentication      → 5 tests [must_have]
# ✓ FEAT-002: Image Upload             → 3 tests [must_have]
# ✗ FEAT-003: Data Export              → 0 tests [must_have] - NEEDS COVERAGE
# ...

# Details for a specific feature
npm run traceability feature FEAT-001

# Reverse lookup: which features does this test validate?
npm run traceability test UNIT-001

# List all features without tests
npm run traceability gaps

# CI check: exits 1 if must_have features lack tests
npm run traceability check
```

### Use Case: Validation-Driven Testing

When a feature is implemented, know exactly which tests to run:

1. Developer completes FEAT-001 (User Authentication)
2. Run `npm run traceability feature FEAT-001`
3. Output shows: `UNIT-001, UNIT-005, INT-003, SEC-001, E2E-001`
4. Run those specific tests to validate the feature

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
│   ├── council.ts        # Spec council runner (merge mode)
│   ├── test-council.ts   # Test council runner (merge mode + traceability)
│   ├── phase.ts          # Phased workflow orchestrator
│   ├── phase-prompts.ts  # Phase-specific prompt templates
│   ├── finalize.ts       # Final spec compilation + feature manifest
│   ├── export-spec.ts    # Spec JSON → markdown conversion
│   ├── export-tests.ts   # Test plan JSON → markdown conversion
│   ├── traceability.ts   # Feature-to-test traceability CLI
│   ├── markdown-utils.ts # Shared markdown formatting utilities
│   ├── validate.ts       # Validation helper
│   ├── init.ts           # Project initialization
│   ├── types.ts          # TypeScript interfaces
│   └── utils.ts          # Utility functions
├── state/
│   ├── conversations/    # Timestamped audit logs
│   ├── checkpoints/      # Pipeline checkpoints for resumption
│   └── *.json, *.md      # Workflow state files
├── schemas/              # JSON schemas for state files
├── prompts/
│   └── workflow.md       # Interview & validation instructions
├── config.json           # Council configuration
├── CLAUDE.md             # AI assistant operating constraints
└── README.md
```

## State Files

### Integrated Workflow

| File | Created By | Contents |
|------|-----------|----------|
| `interview-output.json` | Interview phase | Structured requirements |
| `spec-council-output.json` | Spec Council phase | Multi-agent analysis + spec sections |
| `decisions.json` | Validation phase | Human decisions on ambiguities |
| `spec-final.json` | Finalize phase | Complete specification with feature manifest |
| `spec-final.md` | Export phase | Human-readable specification |
| `test-plan-output.json` | Test Council phase | Comprehensive test plan with feature links |
| `test-plan.md` | Export phase | Human-readable test plan |

### Phased Workflow (Additional Files)

| File | Created By | Contents |
|------|-----------|----------|
| `features-output.json` | Features phase | User stories, acceptance criteria |
| `architecture-output.json` | Architecture phase | Components, APIs, data model |
| `*-advisory.json` | Critique loop | Non-blocking concerns for review |

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
  "deployment": "...",        // ~15KB
  "feature_manifest": {       // Feature traceability
    "features": [
      {
        "id": "FEAT-001",
        "name": "User Authentication",
        "priority": "must_have",
        "validated_by_tests": ["UNIT-001", "INT-003", "SEC-001"]
      }
    ],
    "generated_at": "...",
    "tests_linked_at": "..."  // Updated by test-council
  }
}
```

### Test Plan Structure

The `test-plan-output.json` contains:

```json
{
  "metadata": { "project_id": "...", "total_tests": 42, ... },
  "tests": {
    "unit": [
      {
        "id": "UNIT-001",
        "name": "Password validation rejects weak passwords",
        "validates_features": ["FEAT-001"],  // Links to features
        "priority": "critical",
        "expected_result": "..."
      }
    ],
    "integration": [...],
    "e2e": [...],
    "security": [...],
    "performance": [...],
    "edge_cases": [...]
  },
  "coverage_summary": {
    "features_covered": ["FEAT-001", "FEAT-002"],
    "features_uncovered": ["FEAT-005"],
    "coverage_percentage": 80
  }
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
npm run test           # All tests (111 tests)
npm run test:unit      # Unit tests (54 tests)
npm run test:integration  # Integration tests (25 tests)
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
