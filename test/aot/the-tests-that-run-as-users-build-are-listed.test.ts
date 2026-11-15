// A test file with a line `# AS-USERS-BUILD: <why>` runs without the check that the runner lays on every other file. The line is for the red control of a check that runs in
// every build, and for nothing else: laid on a test that is red under the runner's check it would hide the failure. So each file that bears it is listed here.
import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const listed = [
  "from-source/answers/the-storage-of-a-list-taken-to-be-as-in-front-stops-where-a-turn-has-moved-it.ir",
  "from-source/machine/a-save-at-a-head-that-a-cold-operand-alone-reads-and-that-is-left-out-stops-the-build-by-name.ir",
  "from-source/machine/a-save-at-a-head-that-a-cold-operand-alone-reads-where-more-values-wait-than-registers-are-kept-stops-the-build-by-name.ir",
  "from-source/machine/a-slot-whose-store-is-left-out-though-it-is-read-stops-the-build-by-name.ir",
  "from-source/machine/a-slot-whose-store-is-left-out-though-it-is-read-where-more-values-wait-than-registers-are-kept-stops-the-build-by-name.ir",
  "from-source/machine/an-owner-that-the-collector-alone-reads-and-whose-slot-is-left-unwritten-stops-the-build-by-name.ir",
  "from-source/machine/an-owner-whose-slot-is-left-unwritten-is-not-seen-where-nothing-checks-the-allocation.ir",
  "from-source/machine/an-owner-whose-slot-is-left-unwritten-stops-the-build-by-name-where-the-order-of-blocks-was-made-again.ir",
  "from-source/machine/the-cells-of-built-ins-out-of-order-stop-the-build-by-name.ir",
  "from-source/machine/the-fused-call-entries-out-of-order-stop-the-build-by-name.ir",
  "from-source/machine/the-record-of-a-function-that-is-listed-by-function-is-asked-to-be-there-under-its-number.ir",
  "from-source/machine/the-row-of-a-function-with-large-counts-is-asked-to-be-there-under-its-number.ir",
  "from-source/machine/under-the-words-a-list-that-a-turn-lengthens-is-held-below-its-room.ir",
  "from-source/machine/under-the-words-a-raw-store-into-a-list-is-held-below-its-length.ir",
  "from-source/machine/under-the-words-a-read-behind-a-store-of-the-length-is-held-below-the-length.ir",
  "from-source/walk/builtin-calls/injected-fresh-result-is-caught.ir",
];

test("the tests that run as users build are the listed ones", () => {
  const found: string[] = [];
  for (const file of new Glob("{from-source,answers,ir}/**/*.{ir,ts,js,mjs,cjs}").scanSync(import.meta.dir)) {
    if (/^(#|\/\/( #)?) AS-USERS-BUILD:/m.test(readFileSync(join(import.meta.dir, file), "utf8")))
      found.push(file.replaceAll("\\", "/"));
  }
  expect(found.sort()).toEqual(listed);
});
