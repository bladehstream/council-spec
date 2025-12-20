export interface InterviewOutput {
  problem_statement: {
    summary: string;
    context?: string;
    motivation?: string;
  };
  users_and_actors?: Array<{
    name: string;
    description?: string;
    goals?: string[];
  }>;
  core_functionality: Array<{
    feature: string;
    description?: string;
    priority: 'must_have' | 'should_have' | 'nice_to_have';
  }>;
  constraints?: {
    tech_stack?: string[];
    timeline?: string;
    budget?: string;
    compliance?: string[];
  };
  integration_points?: Array<{
    system: string;
    type: 'api' | 'database' | 'file' | 'event' | 'other';
    direction: 'inbound' | 'outbound' | 'bidirectional';
    notes?: string;
  }>;
  success_criteria?: string[];
  out_of_scope?: string[];
  open_questions?: string[];
  raw_notes?: string;
}

export interface Ambiguity {
  id: string;
  description: string;
  source: 'divergent_responses' | 'missing_info' | 'contradiction' | 'assumption';
  agents_involved?: string[];
  options?: string[];
  /** Priority level from structured output */
  priority?: 'critical' | 'important' | 'minor';
  /** Additional context about why this matters */
  context?: string;
  /** Council's recommended resolution */
  recommendation?: string;
  resolution?: {
    decision: string;
    rationale?: string;
    decided_by: 'human' | 'council' | 'default';
  };
}

export interface CouncilOutput {
  input_hash: string;
  timestamp: string;
  /** Pipeline mode: 'compete' (rank responses) or 'merge' (combine all insights) */
  mode?: 'compete' | 'merge';
  stage1: Array<{
    agent: string;
    model?: string;
    response: string;
    focus_areas?: string[];
  }>;
  /** Stage 2 rankings - null in merge mode (no ranking occurs) */
  stage2: {
    rankings: Array<{
      agent: string;
      ranking: string[];
    }>;
    aggregate: Array<{
      agent: string;
      score: number;
    }>;
  } | null;
  stage3: {
    chairman: string;
    model?: string;
    synthesis: string;
  };
  ambiguities: Ambiguity[];
  spec_sections?: {
    architecture?: string;
    data_model?: string;
    api_contracts?: string;
    user_flows?: string;
    security?: string;
    deployment?: string;
  };
  /** Additional structured data from chairman output */
  _structured?: {
    executive_summary?: string;
    implementation_phases?: Array<{
      phase: number;
      name: string;
      description: string;
      key_deliverables: string[];
    }>;
    consensus_notes?: string;
  };
  /** Custom Stage 2 deduplication result (when COUNCIL_DEDUP is enabled) */
  customStage2?: {
    sections: Record<string, string>;
    conflicts?: Array<{
      topic: string;
      positions: Array<{ agent: string; position: string }>;
    }>;
    uniqueInsights?: Array<{
      source: string;
      insight: string;
    }>;
  };
}

export interface SpecFinal {
  project_id: string;
  version: string;
  created_at: string;
  interview_summary: string;
  decisions: Array<{
    ambiguity_id: string;
    decision: string;
    rationale?: string;
  }>;
  specification: {
    overview: string;
    architecture: string;
    data_model: string;
    api_contracts: string;
    user_flows: string;
    security: string;
    deployment: string;
    acceptance_criteria: string[];
  };
}

export interface Config {
  models: {
    interview: {
      provider: string;
      model: string;
    };
    validation: {
      provider: string;
      model: string;
    };
  };
  council: {
    responders: string;
    evaluators: string;
    chairman: string;
    timeout_seconds: number;
  };
  test_council?: {
    auto_split_tests?: boolean;
    split_step_threshold?: number;
  };
}

// ============================================================================
// Test Plan Types
// ============================================================================

export interface TestSource {
  model: string;              // Primary contributor (e.g., "claude:default" or "chairman")
  merged_from?: string[];     // If deduplicated from multiple models
  similarity_note?: string;   // Optional note if merged similar tests
  created_by_chairman?: boolean; // True if test was added during gap analysis
}

export interface TestCase {
  id: string;
  name: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  preconditions?: string[];
  steps?: string[];
  expected_result: string;
  coverage?: string[];
  source?: TestSource;                              // Model attribution
  atomicity?: 'atomic' | 'split_recommended';       // Atomicity status
  split_suggestion?: string[];                      // Suggested split test names
  split_from?: string;                              // Original test ID if split
  quantifiable?: boolean;                           // False if acceptance criteria unclear
  clarification_needed?: string;                    // What's missing from spec
  suggested_threshold?: string;                     // AI-suggested quantifiable criteria
  spec_section?: string;                            // Where in spec this should be defined
}

export interface TestPlanTests {
  unit: TestCase[];
  integration: TestCase[];
  e2e: TestCase[];
  security: TestCase[];
  performance: TestCase[];
  edge_cases: TestCase[];
}

export interface TestPlanOutput {
  metadata: {
    project_id: string;
    spec_version: string;
    generated_at: string;
    total_tests: number;
    preset_used: string;
  };
  tests: TestPlanTests;
  coverage_summary: {
    features_covered: string[];
    gaps_identified: string[];
    quantifiability?: {
      total_tests: number;
      quantifiable: number;
      needs_clarification: number;
      clarification_report?: string;
    };
  };
  merge_metadata?: {
    models_used: string[];
    unique_contributions: Array<{
      source: string;
      count: number;
    }>;
    attribution_summary?: {
      unique_tests: number;
      merged_tests: number;
      by_model: Record<string, number>;
    };
  };
  split_metadata?: {
    original_count: number;
    split_count: number;
    tests_split: Array<{
      original_id: string;
      split_into: string[];
    }>;
  };
}

// ============================================================================
// Clarification Report Types
// ============================================================================

export interface ClarificationItem {
  test_id: string;
  test_name: string;
  category: string;
  current_expected_result: string;
  clarification_needed: string;
  suggested_threshold?: string;
  spec_section?: string;
}

export interface ClarificationReport {
  generated_at: string;
  project_id: string;
  total_tests: number;
  quantifiable_tests: number;
  needs_clarification: number;
  items: ClarificationItem[];
}
