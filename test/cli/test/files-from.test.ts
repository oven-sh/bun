import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const passes = (name: string) =>
  `import {test,expect} from "bun:test"; test(${JSON.stringify(name)}, () => expect(1).toBe(1));`;

async function run(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    env: bunEnv,
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { out: stdout + stderr, exitCode };
}

test("--files-from runs the listed files and no others", async () => {
  using dir = tempDir("files-from", {
    "a.test.js": passes("alpha"),
    "sub/b.test.js": passes("bravo"),
    "c.test.js": passes("charlie"),
    "d.test.js": passes("delta"),
    // With and without ./, a blank line, CRLF, spaces around a path.
    "list.txt": "./a.test.js\n\nsub/b.test.js\r\n  ./c.test.js  \n",
  });
  const { out, exitCode } = await run(String(dir), "--files-from", "list.txt");
  expect(out).toContain("(pass) alpha");
  expect(out).toContain("(pass) bravo");
  expect(out).toContain("(pass) charlie");
  expect(out).not.toContain("delta");
  expect(out).toContain("Ran 3 tests across 3 files");
  expect(exitCode).toBe(0);
});

test("--files-from adds to the paths on the command line, and may be given twice", async () => {
  using dir = tempDir("files-from-twice", {
    "a.test.js": passes("alpha"),
    "b.test.js": passes("bravo"),
    "c.test.js": passes("charlie"),
    "d.test.js": passes("delta"),
    "one.txt": "a.test.js\n",
    "two.txt": "b.test.js\n",
  });
  const { out, exitCode } = await run(String(dir), "--files-from=one.txt", "--files-from=two.txt", "./c.test.js");
  expect(out).toContain("(pass) alpha");
  expect(out).toContain("(pass) bravo");
  expect(out).toContain("(pass) charlie");
  expect(out).not.toContain("delta");
  expect(exitCode).toBe(0);
});

test("--files-from: a line is a path, not a filter", async () => {
  using dir = tempDir("files-from-not-a-filter", {
    "a.test.js": passes("alpha"),
    "sub/a.test.js": passes("the other alpha"),
    "list.txt": "a.test.js\n",
  });
  const { out, exitCode } = await run(String(dir), "--files-from", "list.txt");
  expect(out).toContain("(pass) alpha");
  expect(out).not.toContain("the other alpha");
  expect(exitCode).toBe(0);
});

test("--files-from works with --parallel", async () => {
  using dir = tempDir("files-from-parallel", {
    "a.test.js": passes("alpha"),
    "b.test.js": passes("bravo"),
    "c.test.js": passes("charlie"),
    "list.txt": "a.test.js\nb.test.js\n",
  });
  const { out, exitCode } = await run(String(dir), "--parallel=2", "--files-from", "list.txt");
  expect(out).toContain("PARALLEL");
  expect(out).toContain("(pass) alpha");
  expect(out).toContain("(pass) bravo");
  expect(out).not.toContain("charlie");
  expect(exitCode).toBe(0);
});

test("--files-from takes a list longer than one argument may be on Linux", async () => {
  const files: Record<string, string> = {};
  const long = Buffer.alloc(180, "x").toString();
  const names = Array.from({ length: 800 }, (_, i) => `${long}-${i}.test.js`);
  // 800 paths of 190 characters: 150 KB. Only three exist; the others are passed over like missing paths on the command line.
  for (const i of [0, 400, 799]) files[names[i]] = passes(`number ${i}`);
  files["list.txt"] = names.join("\n");
  using dir = tempDir("files-from-long", files);
  const { out, exitCode } = await run(String(dir), "--files-from", "list.txt");
  expect(out).toContain("(pass) number 0");
  expect(out).toContain("(pass) number 400");
  expect(out).toContain("(pass) number 799");
  expect(out).toContain("Ran 3 tests across 3 files");
  expect(exitCode).toBe(0);
});

test("--files-from fails on a missing list and on a list with no paths, rather than running every test", async () => {
  using dir = tempDir("files-from-errors", {
    "a.test.js": passes("alpha"),
    "empty.txt": "\n \r\n",
  });
  const missing = await run(String(dir), "--files-from", "nowhere.txt");
  expect(missing.out).toContain("failed to read --files-from file");
  expect(missing.out).not.toContain("alpha");
  expect(missing.exitCode).toBe(1);
  const empty = await run(String(dir), "--files-from", "empty.txt");
  expect(empty.out).toContain("lists no test files");
  expect(empty.out).not.toContain("alpha");
  expect(empty.exitCode).toBe(1);
});

test("--files-from refuses a filter beside it, rather than running the listed files as if it were not there", async () => {
  using dir = tempDir("files-from-filter", {
    "unit-a.test.js": passes("alpha"),
    "other-b.test.js": passes("beta"),
    "list.txt": "unit-a.test.js\nother-b.test.js\n",
  });
  const mixed = await run(String(dir), "unit", "--files-from", "list.txt");
  expect(mixed.out).toContain("unit is a filter, and --files-from takes none beside it");
  expect(mixed.out).not.toContain("beta");
  expect(mixed.exitCode).toBe(1);
});
