import { testCells } from "./harness/cells";
import { call, cells, helpers } from "./harness/two-waits";

testCells("the turns that two waits take", cells(), 2500, helpers, call);
