import { $ } from "bun";
import { expect, test } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

test("shell should handle cwd paths >= MAX_PATH on Windows", async () => {
  if (!isWindows) {
    return;
  }

  using dir = tempDir("long-path-shell", {});

  // Create a deeply nested directory structure that exceeds MAX_PATH (260 chars)
  const segments: string[] = [];
  let currentPath = String(dir);
  let totalLength = currentPath.length;

  // Keep adding directory segments until we exceed MAX_PATH
  let i = 0;
  while (totalLength < 280) {
    const segment = `dir${i.toString().padStart(3, "0")}`;
    segments.push(segment);
    totalLength += segment.length + 1; // +1 for the path separator
    i++;
  }

  // Create the nested directory structure
  let deepPath = String(dir);
  for (const segment of segments) {
    deepPath = join(deepPath, segment);
    await Bun.write(join(deepPath, ".keep"), "");
  }

  console.log(`Created deep path (length: ${deepPath.length}): ${deepPath}`);
  expect(deepPath.length).toBeGreaterThanOrEqual(260);

  // This should either:
  // 1. Succeed and spawn the process
  // 2. Fail gracefully with an error (not panic with UV_ENOTCONN)
  let err;
  try {
    await $`${bunExe()} --version`.cwd(deepPath).quiet();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(Error);
});

test("shell should handle cwd paths with disabled 8.3 names on Windows", async () => {
  if (!isWindows) {
    return;
  }

  using dir = tempDir("8-3-disabled-shell", {
    "test.js": `console.log("hello");`,
  });

  // Create a moderately long path that would trigger GetShortPathNameW
  const segments = Array.from({ length: 20 }, (_, i) => `directory_with_long_name_${i}`);
  let deepPath = String(dir);
  for (const segment of segments) {
    deepPath = join(deepPath, segment);
    await Bun.write(join(deepPath, ".keep"), "");
  }

  console.log(`Created path for 8.3 test (length: ${deepPath.length}): ${deepPath}`);

  // Attempt to copy test.js to the deep path
  let err;
  try {
    await Bun.write(join(deepPath, "test.js"), `console.log("hello");`);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(Error);

  // This should not panic, even if GetShortPathNameW fails
  err = undefined;
  try {
    await $`${bunExe()} test.js`.cwd(deepPath).quiet();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(Error);
});
