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
  resolution?: {
    decision: string;
    rationale?: string;
    decided_by: 'human' | 'council' | 'default';
  };
}

export interface CouncilOutput {
  input_hash: string;
  timestamp: string;
  stage1: Array<{
    agent: string;
    model?: string;
    response: string;
    focus_areas?: string[];
  }>;
  stage2: {
    rankings: Array<{
      agent: string;
      ranking: string[];
    }>;
    aggregate: Array<{
      agent: string;
      score: number;
    }>;
  };
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
}
