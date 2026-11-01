import { testCells } from "./harness/cells";
import { call, cells, helpers } from "./harness/text-steps";

testCells(
  "a text that grows by three steps, 1 or 40 at a time",
  ["1", "40"].flatMap(cells),
  4000,
  helpers,
  call,
  undefined,
  40,
);
