// Test for issue #18875: bun patch --commit error on windows
// https://github.com/oven-sh/bun/issues/18875
//
// On Windows, bun patch --commit would fail with:
// "EPERM: Operation not permitted: failed renaming patch file to patches dir (copyfile)"
//
// The issue was that when the temp directory and project directory are on different
// volumes (cross-device), the rename operation fails. The fallback code for cross-device
// moves (moveFileZSlowMaybe) was deleting the source file BEFORE copying it, which
// doesn't work on Windows because:
// 1. Windows can't delete a file that has an open handle unless FILE_SHARE_DELETE is used
// 2. The Windows implementation uses GetFinalPathNameByHandleW to get the path, then
//    CopyFileW, which requires the source path to still exist.

import { $, ShellOutput } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

const expectNoError = (o: ShellOutput) => expect(o.stderr.toString()).not.toContain("error");

test("bun patch --commit should work (issue #18875)", async () => {
  // This test verifies that bun patch --commit works correctly.
  // The original issue occurred on Windows when the temp directory was on a different
  // volume than the project directory, causing a cross-device rename failure.
  const tempdir = tempDirWithFiles("issue-18875", {
    "package.json": JSON.stringify({
      name: "bun-patch-test-18875",
      module: "index.ts",
      type: "module",
      dependencies: {
        "is-even": "1.0.0",
      },
    }),
    "index.ts": `import isEven from 'is-even'; console.log(isEven(420))`,
  });

  // Install dependencies
  expectNoError(await $`${bunExe()} i`.env(bunEnv).cwd(tempdir));

  // Start patching
  const patchResult = await $`${bunExe()} patch is-even`.env(bunEnv).cwd(tempdir);
  expect(patchResult.stderr.toString()).not.toContain("error");

  // Make a simple change to the package
  const patchedCode = `/*!
* is-even <https://github.com/jonschlinkert/is-even>
*
* Copyright (c) 2015, 2017, Jon Schlinkert.
* Released under the MIT License.
*/

'use strict';

var isOdd = require('is-odd');

module.exports = function isEven(i) {
  console.log("Patched via issue #18875 test");
  return !isOdd(i);
};
`;

  await $`echo ${patchedCode} > node_modules/is-even/index.js`.env(bunEnv).cwd(tempdir);

  // Commit the patch - this is where the bug occurred on Windows
  const commitResult = await $`${bunExe()} patch --commit node_modules/is-even`.env(bunEnv).cwd(tempdir);

  // Verify no EPERM error occurred
  expect(commitResult.stderr.toString()).not.toContain("EPERM");
  expect(commitResult.stderr.toString()).not.toContain("error");

  // Verify the patch was applied correctly by running the patched code
  const runResult = await $`${bunExe()} run index.ts`.env(bunEnv).cwd(tempdir);
  expect(runResult.stdout.toString()).toContain("Patched via issue #18875 test");
  expect(runResult.stdout.toString()).toContain("true");
});
