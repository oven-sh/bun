// The project, and what it is for: ./harness/three-layers-agree.ts.
import { answerAsPlainBunTest } from "./harness/three-layers-agree";

answerAsPlainBunTest({
  "in small pieces": { words: "TestRunLayers:2,TestRunPartFiles:8" },
  // The files of the project are two programs, one above the other.
  "the project in two": { words: "TestRunLayers:3,TestRunPartFiles:8" },
});
