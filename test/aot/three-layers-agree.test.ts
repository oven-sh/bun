// The project, and what it is for: ./harness/three-layers-agree.ts.
import { answerAsPlainBunTest } from "./harness/three-layers-agree";
import { runsWholeGrids } from "./harness/ways";

answerAsPlainBunTest({
  // Without --parallel a run builds itself as one program: the word asks for the build that the next way makes.
  ...(runsWholeGrids && { "as one program": { words: "TestRunLayers:0" } }),
  "in layers": {},
});
