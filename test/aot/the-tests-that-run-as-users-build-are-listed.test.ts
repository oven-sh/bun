// A test file with a line `# AS-USERS-BUILD: <why>` runs without the check that the runner lays on every other file. The line is for the red control of a check that runs in
// every build, and for nothing else: laid on a test that is red under the runner's check it would hide the failure. So each file that bears it is listed here.
import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const listed = [
  "from-source/machine/a-save-at-a-head-that-a-cold-operand-alone-reads-and-that-is-left-out-stops-the-build-by-name.ir",
  "from-source/machine/a-slot-whose-store-is-left-out-though-it-is-read-stops-the-build-by-name.ir",
  "from-source/machine/an-owner-that-the-collector-alone-reads-and-whose-slot-is-left-unwritten-stops-the-build-by-name.ir",
  "from-source/machine/what-a-hint-releases-though-a-way-on-reads-it-stops-the-build-by-name.ir",
];

test("the tests that run as users build are the listed ones", () => {
  const found: string[] = [];
  for (const file of new Glob("{from-source,answers,ir}/**/*.{ir,ts,js,mjs,cjs}").scanSync(import.meta.dir)) {
    if (/^(#|\/\/( #)?) AS-USERS-BUILD:/m.test(readFileSync(join(import.meta.dir, file), "utf8")))
      found.push(file.replaceAll("\\", "/"));
  }
  expect(found.sort()).toEqual(listed);
});
