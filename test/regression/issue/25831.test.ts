import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("ls -l shows long listing format", async () => {
  // Create temp directory with test files
  using dir = tempDir("ls-long-listing", {
    "file.txt": "hello world",
    "script.sh": "#!/bin/bash\necho hello",
    subdir: {
      "nested.txt": "nested content",
    },
  });

  // Run ls -l in the temp directory
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      import { $ } from "bun";
      $.cwd("${String(dir).replace(/\\/g, "\\\\")}");
      const result = await $\`ls -l\`.text();
      console.log(result);
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Verify no errors on stderr
  expect(stderr).toBe("");

  // Should show permission string (starts with - or d, followed by rwx/sStT permissions)
  // Format: -rw-r--r-- 1 uid gid size date name
  expect(stdout).toMatch(/^[-dlbcps][-rwxsStT]{9}/m); // Permission string pattern
  expect(stdout).toContain("file.txt");
  expect(stdout).toContain("script.sh");
  expect(stdout).toContain("subdir");

  // Verify that it's actually showing long format (contains size and date info)
  // Long format has at least permissions, link count, uid, gid, size, date, name
  const lines = stdout
    .trim()
    .split("\n")
    .filter(line => line.includes("file.txt"));
  expect(lines.length).toBeGreaterThan(0);

  // Each line should have multiple space-separated fields
  const fileLine = lines[0];
  const fields = fileLine.trim().split(/\s+/);
  expect(fields.length).toBeGreaterThanOrEqual(7); // perms, nlink, uid, gid, size, date fields, name

  expect(exitCode).toBe(0);
});

test("ls without -l shows short format", async () => {
  using dir = tempDir("ls-short-listing", {
    "file1.txt": "content1",
    "file2.txt": "content2",
  });

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      import { $ } from "bun";
      $.cwd("${String(dir).replace(/\\/g, "\\\\")}");
      const result = await $\`ls\`.text();
      console.log(result);
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Verify no errors on stderr
  expect(stderr).toBe("");

  // Short format should just show filenames, not permission strings
  expect(stdout).not.toMatch(/^[-dlbcps][-rwxsStT]{9}/m);
  expect(stdout).toContain("file1.txt");
  expect(stdout).toContain("file2.txt");

  expect(exitCode).toBe(0);
});

test("ls -al shows hidden files in long format", async () => {
  using dir = tempDir("ls-all-long", {
    ".hidden": "hidden content",
    "visible.txt": "visible content",
  });

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      import { $ } from "bun";
      $.cwd("${String(dir).replace(/\\/g, "\\\\")}");
      const result = await $\`ls -al\`.text();
      console.log(result);
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Verify no errors on stderr
  expect(stderr).toBe("");

  // Should show hidden files
  expect(stdout).toContain(".hidden");
  expect(stdout).toContain("visible.txt");
  // Should also show . and .. entries
  expect(stdout).toMatch(/^d[-rwxsStT]{9}.*\s\.$/m); // . directory
  expect(stdout).toMatch(/^d[-rwxsStT]{9}.*\s\.\.$/m); // .. directory

  // Should be in long format
  expect(stdout).toMatch(/^[-dlbcps][-rwxsStT]{9}/m);

  expect(exitCode).toBe(0);
});

test("ls -l shows directory type indicator", async () => {
  using dir = tempDir("ls-dir-type", {
    "regular-file.txt": "content",
    subdir: {
      "nested.txt": "nested",
    },
  });

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      import { $ } from "bun";
      $.cwd("${String(dir).replace(/\\/g, "\\\\")}");
      const result = await $\`ls -l\`.text();
      console.log(result);
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Verify no errors on stderr
  expect(stderr).toBe("");

  // Directory should start with 'd'
  expect(stdout).toMatch(/^d[-rwxsStT]{9}.*subdir$/m);
  // Regular file should start with '-'
  expect(stdout).toMatch(/^-[-rwxsStT]{9}.*regular-file\.txt$/m);

  expect(exitCode).toBe(0);
});
