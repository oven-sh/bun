// The one module that conformance.test.ts and sweep.ts import.
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
