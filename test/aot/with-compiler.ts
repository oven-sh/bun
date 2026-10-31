// `test` and `describe` of bun:test for a file that asks the front end of the compiler in this process.
// In a Bun that was built without the compiler they define nothing.
import { describeCheckerQueries } from "bun:internal-for-testing";
import { describe as describeAnywhere, setDefaultTimeout, test as testAnywhere } from "bun:test";
import { join } from "node:path";

function hasCompiler() {
  try {
    return describeCheckerQueries(join(import.meta.dir, "no-such-file.ts"), 1) !== undefined;
  } catch {
    return true;
  }
}

export const unsupported = !hasCompiler();
if (unsupported) console.error("SKIPPED: the tests in this file: this Bun was built without the compiler");

const nothing: any = new Proxy(() => nothing, { get: () => nothing });
export const test: typeof testAnywhere = unsupported ? nothing : testAnywhere;
export const describe: typeof describeAnywhere = unsupported ? nothing : describeAnywhere;

// A debug build with a sanitizer takes twenty times as long as a release build.
setDefaultTimeout(120_000);
