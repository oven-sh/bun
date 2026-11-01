import { testCells } from "./harness/cells";
import { call, cells, helpers } from "./harness/try-exits";

testCells("every way to leave a try, a catch and a finally", cells(), 3500, helpers, call);
