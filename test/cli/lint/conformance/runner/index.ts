// The one module that conformance.test.ts and sweep.ts import.
export {
  ExpectationsError,
  checkLists,
  compareNames,
  compareWithRevision,
  expectationsAtRevision,
  formatExpectations,
  overQuota,
  parseExpectations,
  plan,
  reportText,
  sampleListed,
  updateCommand,
  verify,
} from "./expectations";
export type {
  Expectations,
  Failure,
  FailureReason,
  InstanceFacts,
  Kind,
  Level,
  Plan,
  ResultFacts,
  Shrink,
} from "./expectations";
export { emptyCheck, outcomes, replayCheck, runInstance, runInstances } from "./run";
export type {
  Check,
  CheckInput,
  CheckResult,
  InputResult,
  Instance,
  Outcome,
  RunOptions,
  RunResult,
  Symlink,
} from "./run";
export type { Diagnostic, InputFile } from "./shape";
