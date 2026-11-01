// The project, and what it is for: ./harness/three-layers-agree.ts.
import { answerAsPlainBunTest } from "./harness/three-layers-agree";

answerAsPlainBunTest({
  // Each program is lowered in three passes, each with a type checker that knows nothing yet.
  "with new checkers": { words: "TestRunLayers:2,TestRunPartFiles:8,TestRunCheckerPasses:3" },
  // The run time checks its own tables at the end of each collection and wherever it files an answer: a wrong row stops the run where no value shows it yet.
  "with the run time checking itself": { env: { BUN_JSC_validateAOTRuntime: "1" } },
});
