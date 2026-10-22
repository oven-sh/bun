// The code is laid out as if calls reached only far enough to need three copies of the shared stubs, as in a very large program.
import { variant } from "./run-programs";

variant("stub-copies", [], {}, 3, 3, "", 3);
