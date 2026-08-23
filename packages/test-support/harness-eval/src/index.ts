/** Generic deterministic A/B evaluation support for repository tests. */
export { FIXTURES } from './fixtures.ts'
export { classifyProcessCompletion, runValidationCommand } from './process.ts'
export {
  runAbEval,
  type AbEvalOptions,
  type AbEvalProgress,
  type EvalExecutor,
  type EvalExecutorInput,
  type EvalExecutorResult,
  type EvalReviewer,
  type EvalReviewerInput,
  type EvalReviewerResult,
} from './runner.ts'
export { renderComparisonHtml, writeComparisonReports } from './report.ts'
export { runBlindReviews, type BlindReviewInput, type BlindReviewResult } from './reviewers.ts'
export {
  OX_ALPHA_MODEL,
  OX_ALPHA_REASONING_EFFORT,
  OPENROUTER_RESPONSES_URL,
  codexConfigText,
  createCodexExecutor,
  createCodexVsHarnessExecutor,
  createDeepSeekHarnessExecutor,
  executorMetadata,
  runCodexExecutor,
  runDeepSeekHarnessExecutor,
  resolveCodexExecutorArgv,
  type CodexExecutorOptions,
  type DeepSeekHarnessExecutorOptions,
  type DeepSeekHarnessLaunch,
  type ExecutorRequest,
  type ExecutorResult,
  type RealExecutorMetadata,
} from './executors.ts'
export { COMPARISON_SCHEMA_VERSION } from './types.ts'
export type {
  AbComparison,
  AbRunArtifact,
  AbVariant,
  AdjudicationArtifact,
  EvalWorkUnit,
  ExecutorEvidence,
  ExecutorMetadata,
  ExecutorTiming,
  ExecutionMode,
  FixtureCategory,
  FixtureSpec,
  FixtureSuite,
  NormalizedCost,
  NormalizedUsage,
  ProcessCompletion,
  RoutingArtifact,
  ReviewDimensions,
  ReviewFinding,
  ReviewerArtifact,
  ValidationClassification,
  ValidationResult,
  WorkerArtifact,
} from './types.ts'
