import { describe, expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, isLinux, tempDir, tmpdirSync } from "harness";
import { join } from "path";

test("it will create a snapshot file and directory if they don't exist", () => {
  const tempDir = tmpdirSync();
  fs.rmSync(tempDir, { force: true, recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });

  fs.copyFileSync(import.meta.dir + "/new-snapshot.ts", tempDir + "/new-snapshot.test.ts");
  const { exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "test"],
    cwd: tempDir,
    env: { ...bunEnv, CI: "false" },
  });

  expect(exitCode).toBe(0);
  expect(fs.existsSync(tempDir + "/__snapshots__/new-snapshot.test.ts.snap")).toBe(true);

  // remove the snapshot file but leave the directory and test again.
  fs.rmSync(tempDir + "/__snapshots__/new-snapshot.test.ts.snap", { force: true });
  const { exitCode: exitCode2 } = Bun.spawnSync({
    cmd: [bunExe(), "test"],
    cwd: tempDir,
    env: { ...bunEnv, CI: "false" },
  });

  expect(exitCode2).toBe(0);
  expect(fs.existsSync(tempDir + "/__snapshots__/new-snapshot.test.ts.snap")).toBe(true);
});

const HEADER = "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n";
const A_TEST = `
  import { test, expect } from "bun:test";
  test("a", () => expect("hello").toMatchSnapshot());
`;
const B_TEST = `
  import { test, expect } from "bun:test";
  test("b", () => expect("world").toMatchSnapshot());
`;
const VALUE_ERROR = "The snapshot value must be a template literal without substitutions";
const NAME_ERROR = "The snapshot name must be a template literal without substitutions";

// CI=false: only a run that may add snapshots can append to the file.
async function runBunTest(dir: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    cwd: dir,
    env: { ...bunEnv, CI: "false" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe("a .snap entry bun test cannot read", () => {
  // Each entry below is line 3 of its .snap file. The reader used to skip it, so the snapshot
  // counted as new: the test passed, and a second `a 1` entry was appended under the bad one.
  test.concurrent.each([
    ["a substitution in the value", "exports[`a 1`] = `${x}`;", "3:18", VALUE_ERROR],
    ["a substitution in the name", 'exports[`a ${1}`] = `"hello"`;', "3:9", NAME_ERROR],
    ["a regular expression as the value", "exports[`a 1`] = /hello/;", "3:18", VALUE_ERROR],
    ["a number as the value", "exports[`a 1`] = 1;", "3:18", VALUE_ERROR],
    ["a concatenation as the value", 'exports[`a 1`] = `"hel"` + `"lo"`;', "3:18", VALUE_ERROR],
    [
      "a statement that is not an exports[...] assignment",
      'module.exports[`a 1`] = `"hello"`;',
      "3:1",
      "Expected a snapshot entry: exports[`name`] = `value`;",
    ],
  ])("%s fails the test and leaves the file alone", async (_, entry, position, message) => {
    const snap = `${HEADER}\n${entry}\n`;
    using dir = tempDir("snap-bad-entry", { "a.test.ts": A_TEST, "__snapshots__/a.test.ts.snap": snap });
    const snapPath = join(String(dir), "__snapshots__", "a.test.ts.snap");

    const { stderr, exitCode } = await runBunTest(String(dir));
    expect(stderr).toContain(`error: ${message}\n    at ${snapPath}:${position}\n`);
    expect(stderr).toContain("Failed to parse snapshot file");
    expect(stderr).toContain(" 1 fail");
    expect(stderr).not.toContain("added");
    expect(exitCode).toBe(1);
    expect(fs.readFileSync(snapPath, "utf8")).toBe(snap);
  });

  test.concurrent("every bad entry of the file is reported at once", async () => {
    const snap = `${HEADER}\nexports[\`a 1\`] = \`\${x}\`;\n\nexports[\`a \${2}\`] = \`"hello"\`;\n\nexports[\`b 1\`] = \`"ok"\`;\n`;
    using dir = tempDir("snap-bad-entries", { "a.test.ts": A_TEST, "__snapshots__/a.test.ts.snap": snap });
    const snapPath = join(String(dir), "__snapshots__", "a.test.ts.snap");

    const { stderr, exitCode } = await runBunTest(String(dir));
    expect(stderr).toContain(`error: ${VALUE_ERROR}\n    at ${snapPath}:3:18\n`);
    expect(stderr).toContain(`error: ${NAME_ERROR}\n    at ${snapPath}:5:9\n`);
    expect(stderr.split(`    at ${snapPath}:`)).toHaveLength(3);
    expect(exitCode).toBe(1);
    expect(fs.readFileSync(snapPath, "utf8")).toBe(snap);
  });

  test.concurrent("a file that does not parse names the line and does not break the next test file", async () => {
    const torn = `${HEADER}\nexports[\`a 1\`] = \`"hello;\n`;
    const intact = `${HEADER}\nexports[\`b 1\`] = \`"world"\`;\n`;
    using dir = tempDir("snap-torn", {
      "a.test.ts": A_TEST,
      "b.test.ts": B_TEST,
      "__snapshots__/a.test.ts.snap": torn,
      "__snapshots__/b.test.ts.snap": intact,
    });
    const snapPath = join(String(dir), "__snapshots__", "a.test.ts.snap");

    const { stderr, exitCode } = await runBunTest(String(dir));
    expect(stderr).toContain(`\n    at ${snapPath}:3:18\n`);
    expect(stderr).toContain("Failed to parse snapshot file");
    expect(stderr).not.toContain("Failed to snapshot value");
    // a.test.ts must run first. The bytes of its unreadable .snap file used to stay in the buffer
    // that b.test.ts.snap was then read into, so b's valid snapshot failed to parse as well.
    expect(stderr.match(/^\w+\.test\.ts:$/gm)).toEqual(["a.test.ts:", "b.test.ts:"]);
    expect(stderr).toContain("(pass) b");
    expect(stderr).toContain(" 1 pass\n 1 fail\n");
    expect(exitCode).toBe(1);
    expect(fs.readFileSync(snapPath, "utf8")).toBe(torn);
    expect(fs.readFileSync(join(String(dir), "__snapshots__", "b.test.ts.snap"), "utf8")).toBe(intact);
  });

  test.concurrent("--update-snapshots rewrites the file", async () => {
    using dir = tempDir("snap-bad-entry-update", {
      "a.test.ts": A_TEST,
      "__snapshots__/a.test.ts.snap": `${HEADER}\nexports[\`a 1\`] = \`\${x}\`;\n`,
    });
    const snapPath = join(String(dir), "__snapshots__", "a.test.ts.snap");

    const { stderr, exitCode } = await runBunTest(String(dir), "--update-snapshots");
    expect(stderr).not.toContain("Failed to parse snapshot file");
    expect(stderr).toContain("snapshots: +1 added");
    expect(exitCode).toBe(0);
    expect(fs.readFileSync(snapPath, "utf8")).toBe(`${HEADER}\nexports[\`a 1\`] = \`"hello"\`;\n`);
  });

  test.concurrent("comments, directives, empty statements and escaped ${} are still read", async () => {
    using dir = tempDir("snap-trivia", {
      "a.test.ts": `
        import { test, expect } from "bun:test";
        test("a", () => expect("\${x} and \`ticks\`").toMatchSnapshot());
      `,
    });
    const snapPath = join(String(dir), "__snapshots__", "a.test.ts.snap");
    expect((await runBunTest(String(dir))).exitCode).toBe(0);

    const written = fs.readFileSync(snapPath, "utf8");
    expect(written).toContain("\\${x} and \\`ticks\\`");
    const edited = written.replace(HEADER, `${HEADER}"use strict";\n/*! kept */\n;\n`);
    fs.writeFileSync(snapPath, edited);

    const { stderr, exitCode } = await runBunTest(String(dir));
    expect(stderr).not.toContain("error:");
    expect(stderr).toContain(" 1 snapshots, ");
    expect(exitCode).toBe(0);
    expect(fs.readFileSync(snapPath, "utf8")).toBe(edited);
  });
});

// /dev/full reads as empty and refuses every write with ENOSPC.
test.skipIf(!isLinux || !fs.existsSync("/dev/full"))(
  "a .snap file that cannot be written does not leak into the next test file",
  async () => {
    using dir = tempDir("snap-unwritable", {
      "a.test.ts": A_TEST,
      "b.test.ts": `
        import { test, expect } from "bun:test";
        test("b1", () => expect(1).toMatchSnapshot());
        test("b2", () => expect(2).toMatchSnapshot());
      `,
    });
    fs.mkdirSync(join(String(dir), "__snapshots__"));
    fs.symlinkSync("/dev/full", join(String(dir), "__snapshots__", "a.test.ts.snap"));

    // a's entry is written, and fails to be written, when b1 opens b's own .snap file.
    const { stderr, exitCode } = await runBunTest(String(dir));
    expect(stderr.match(/^\w+\.test\.ts:$/gm)).toEqual(["a.test.ts:", "b.test.ts:"]);
    expect(stderr).toContain("Failed write to snapshot file");
    expect(stderr).toContain(" 2 pass\n 1 fail\n");
    expect(exitCode).toBe(1);
    // b's file used to start with a's unwritten entry, followed by a second header.
    expect(fs.readFileSync(join(String(dir), "__snapshots__", "b.test.ts.snap"), "utf8")).toBe(
      `${HEADER}\nexports[\`b2 1\`] = \`2\`;\n`,
    );
  },
);
