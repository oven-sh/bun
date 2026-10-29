// `test`, `describe` and `beforeAll` of ./supported for a file whose tests read how often compiled code called the operations of
// the run time: the lines "operation:" in the file of BUN_JSC_aotCountsPath. A call is counted by a function that stands in the
// operation's place and goes on into it by a tail call, because an operation looks for its caller's frame right above its own.
// clang promises no tail call on Windows (HAVE_MUST_TAIL_CALL in wtf/Compiler.h), so nothing is counted there, and every test is
// skipped.
import { describe as describeAnywhere, test as testAnywhere } from "bun:test";
import { isWindows } from "harness";
import { basename } from "node:path";
import {
  alwaysSkipped,
  beforeAll as beforeAllWhereSupported,
  describe as describeWhereSupported,
  test as testWhereSupported,
  unsupported,
} from "./supported";

export { unsupported };

const countsNoCalls = isWindows;

if (countsNoCalls && !unsupported)
  console.error(`SKIPPED: ${basename(Bun.main)}: the run time counts no calls of its operations on Windows`);

export const test = countsNoCalls ? alwaysSkipped(testAnywhere.skip) : testWhereSupported;
export const describe = countsNoCalls ? alwaysSkipped(describeAnywhere.skip) : describeWhereSupported;
export const beforeAll: typeof beforeAllWhereSupported = countsNoCalls ? () => {} : beforeAllWhereSupported;
