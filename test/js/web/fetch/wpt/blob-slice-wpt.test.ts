// Runs the vendored Web Platform Tests FileAPI/blob/Blob-slice.any.js and its
// include FileAPI/support/Blob.js against Blob.prototype.slice. Both files are
// byte-identical to upstream.
//
// Vendored from web-platform-tests/wpt at a7b77472dc44:
//   FileAPI/blob/Blob-slice.any.js
//   FileAPI/support/Blob.js
//
// The file registers subtests from inside a running test(), which bun:test
// does not take. So the whole file runs inside one bun test: a test() body
// runs when it is registered, as in testharness.js, and the outcome of each
// subtest is collected.

import { expect, test as bunTest } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setRegistrar, wptTest } from "../../../third_party/wpt-testharness-shim";

// `new Blob().slice(0, 0, null).type` is "" where the File API gives "null": a
// slice of an empty Blob drops the type, and slice does not convert a
// contentType that is not a string.
const knownFailures = ["null type Blob slice"];

bunTest("FileAPI/blob/Blob-slice.any.js", async () => {
  const outcomes: { name: string; passed: boolean }[] = [];
  const running: Promise<unknown>[] = [];
  setRegistrar((name, run) => {
    running.push(
      run().then(
        () => outcomes.push({ name, passed: true }),
        () => outcomes.push({ name, passed: false }),
      ),
    );
  });

  const read = (file: string) => readFileSync(join(import.meta.dir, "FileAPI", file), "utf8");
  // bun:test injects its own `test` binding into a module, so the file runs as
  // the body of a Function whose `test` parameter is the shim's.
  new Function("test", `${read("support/Blob.js")}\n;\n${read("blob/Blob-slice.any.js")}`)(wptTest);

  for (let seen = -1; seen !== running.length;) {
    seen = running.length;
    await Promise.all(running);
  }

  expect(outcomes.filter(outcome => !outcome.passed).map(outcome => outcome.name)).toEqual(knownFailures);
  expect(outcomes).toHaveLength(150);
});
