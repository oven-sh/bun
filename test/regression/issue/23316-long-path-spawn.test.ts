import { expect, test } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

test("spawn should handle cwd paths >= MAX_PATH on Windows", async () => {
  if (!isWindows) {
    return;
  }

  using dir = tempDir("long-path-spawn", {});

  // Create a deeply nested directory structure that exceeds MAX_PATH (260 chars)
  // Windows MAX_PATH is 260, so we'll create a path > 260 characters
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
    await Bun.spawn({
      cmd: [bunExe(), "--version"],
      cwd: deepPath,
      stdout: "pipe",
      stderr: "pipe",
    }).exited;
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(Error);
});

test("spawn should handle cwd paths with disabled 8.3 names on Windows", async () => {
  if (!isWindows) {
    return;
  }

  using dir = tempDir("8-3-disabled-spawn", {
    "test.js": `console.log("hello");`,
  });

  // Create a moderately long path that would trigger GetShortPathNameW
  // but might fail if 8.3 names are disabled
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
    const proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: deepPath,
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) throw new Error("process exited");
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(Error);
});
