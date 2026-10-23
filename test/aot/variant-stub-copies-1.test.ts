// The code is laid out as if calls reached only far enough to need three copies of the shared stubs, as in a very large program.
import { variant } from "./run-programs";

variant(
  "stub-copies",
  [],
  {},
  1,
  3,
  "async-and-generators/what-an-async-generator-throws-reaches-the-catch-around-the-loop",
  3,
);
