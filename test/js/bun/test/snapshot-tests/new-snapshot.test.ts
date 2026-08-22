import { describe, expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, isASAN, isWindows, tempDir, tmpdirSync } from "harness";
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

// The name of the file the .snap file is written through must not grow with the name of the .snap
// file, which can already be as long as the file system allows (255 bytes here).
test.skipIf(isWindows)("writes the .snap file of a test file with the longest possible name", async () => {
  const name = Buffer.alloc(250 - ".test.ts".length, "a").toString() + ".test.ts";
  using dir = tempDir("snap-long-name", {
    [name]: `import { test, expect } from "bun:test"; test("k", () => expect(1).toMatchSnapshot());`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "./" + name],
    cwd: String(dir),
    env: { ...bunEnv, CI: "false" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);
  expect(stderr).toContain("snapshots: +1 added");
  expect(fs.existsSync(join(String(dir), "__snapshots__", name + ".snap"))).toBe(true);
  expect(exitCode).toBe(0);
});

// The runs below share one project directory on purpose: several `bun test` processes of the
// same file at the same time (a CI matrix, two terminals) must leave the files they write in
// one piece. Each process records values of a different length, so two of them writing the same
// file in place leave the tail of the longer one behind the shorter one.
describe("snapshot files written by several processes", () => {
  // `PAD` comes from the environment, so each process records values of its own length. The first
  // snapshot loads the .snap file; the process creates LOADED right after that, and it exits only
  // once WAIT_FOR exists.
  const SNAPSHOT_TEST_FILE = (count: number) => `
    import { test, expect } from "bun:test";
    import { existsSync, writeFileSync } from "fs";
    const PAD = Buffer.alloc(Number(process.env.PAD), "#").toString();
    test("k0", () => expect({ i: 0, s: PAD }).toMatchSnapshot());
    test("loaded", () => {
      if (process.env.LOADED) writeFileSync(process.env.LOADED, "");
    });
    ${Array.from({ length: count - 1 }, (_, i) => `test("k${i + 1}", () => expect({ i: ${i + 1}, s: PAD }).toMatchSnapshot());`).join("\n")}
    test("waits", () => {
      // The test writes WAIT_FOR. The deadline only bounds the damage if it never does.
      const deadline = Date.now() + 30_000;
      if (process.env.WAIT_FOR) while (!existsSync(process.env.WAIT_FOR) && Date.now() < deadline) Bun.sleepSync(5);
    });
  `;

  const INLINE_TEST_FILE = (count: number) => `
    import { test, expect } from "bun:test";
    const PAD = Buffer.alloc(Number(process.env.PAD), "#").toString();
    ${Array.from({ length: count }, (_, i) => `test("k${i}", () => {\n  expect("${i}:" + PAD).toMatchInlineSnapshot();\n});`).join("\n")}
  `;

  function runTest(dir: string, env: Record<string, string>) {
    return Bun.spawn({
      cmd: [bunExe(), "test", "./a.test.ts"],
      cwd: dir,
      env: { ...bunEnv, CI: "false", ...env },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  async function finished(proc: ReturnType<typeof runTest>) {
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode, maxRSS: proc.resourceUsage()!.maxRSS };
  }

  function snapshotKeys(snap: string) {
    return snap.match(/^exports\[`[^`]*`\]/gm) ?? [];
  }

  const COUNT = 40;

  test.concurrent("a .snap file has the entries of exactly one process", async () => {
    using dir = tempDir("snap-two-writers", { "a.test.ts": SNAPSHOT_TEST_FILE(COUNT) });
    const loaded = join(String(dir), "loaded");
    const release = join(String(dir), "release");

    // The process with the short values loads the missing .snap file first. Then the one with the
    // long values runs to the end and writes the file. Then the short one writes its own, shorter,
    // file over it.
    await using short = runTest(String(dir), { PAD: "4", LOADED: loaded, WAIT_FOR: release });
    while (!fs.existsSync(loaded)) {
      expect(short.exitCode).toBeNull();
      await Bun.sleep(5);
    }
    const long = await finished(runTest(String(dir), { PAD: "400" }));
    fs.writeFileSync(release, "");
    expect(long.stderr).toContain(`snapshots: +${COUNT} added`);
    expect(long.exitCode).toBe(0);
    const shortResult = await finished(short);
    expect(shortResult.stderr).toContain(`snapshots: +${COUNT} added`);
    expect(shortResult.exitCode).toBe(0);

    const snap = fs.readFileSync(join(String(dir), "__snapshots__", "a.test.ts.snap"), "utf8");
    const keys = snapshotKeys(snap);
    expect({ keys: keys.length, unique: new Set(keys).size }).toEqual({ keys: COUNT, unique: COUNT });
    // The file holds the values of the process that wrote last, and nothing else.
    expect(snap).toContain(`"s": "####"`);
    expect(snap).not.toContain("#".repeat(5));

    // A third process reads it back without complaint.
    const again = await finished(runTest(String(dir), { PAD: "4" }));
    expect(again.stderr).not.toContain("error:");
    expect(again.stderr).toContain(`${COUNT} snapshots, `);
    expect(again.exitCode).toBe(0);
  });

  test.concurrent("a process that adds nothing leaves the .snap file alone", async () => {
    using dir = tempDir("snap-unchanged", { "a.test.ts": SNAPSHOT_TEST_FILE(COUNT) });
    const snapPath = join(String(dir), "__snapshots__", "a.test.ts.snap");
    expect((await finished(runTest(String(dir), { PAD: "4" }))).exitCode).toBe(0);
    const written = fs.statSync(snapPath);
    const stamp = new Date("2000-01-01T00:00:00Z");
    fs.utimesSync(snapPath, stamp, stamp);

    expect((await finished(runTest(String(dir), { PAD: "4" }))).exitCode).toBe(0);
    expect(fs.statSync(snapPath)).toMatchObject({ size: written.size, mtimeMs: stamp.getTime() });
  });

  test.concurrent("the source file of inline snapshots stays valid", async () => {
    using dir = tempDir("inline-many-writers", { "a.test.ts": INLINE_TEST_FILE(COUNT) });
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => finished(runTest(String(dir), { PAD: String(1 + i * 20) }))),
    );
    expect(results.some(({ exitCode }) => exitCode === 0)).toBe(true);

    // Whatever the order the processes finished in, the file is one process's complete output:
    // it parses, every call has its value, and the values all have the same length.
    const source = fs.readFileSync(join(String(dir), "a.test.ts"), "utf8");
    expect(() => new Bun.Transpiler({ loader: "ts" }).transformSync(source)).not.toThrow();
    const values = [...source.matchAll(/toMatchInlineSnapshot\(`"(\d+):(#+)"`\)/g)];
    expect(values.map(match => match[1])).toEqual(Array.from({ length: COUNT }, (_, i) => String(i)));
    expect(new Set(values.map(match => match[2].length)).size).toBe(1);
    expect(source.match(/toMatchInlineSnapshot\(/g)).toHaveLength(COUNT);
  });
});

describe("a .snap file that does not parse", () => {
  // Enough tests that re-reading the file once per test would show up in memory.
  const COUNT = 300;
  const TEST_FILE = `
    import { test, expect } from "bun:test";
    ${Array.from({ length: COUNT }, (_, i) => `test("k${i}", () => expect({ i: ${i}, s: "x".repeat(${i % 50}) }).toMatchSnapshot());`).join("\n")}
  `;

  async function runTest(dir: string, ...args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...args, "./a.test.ts"],
      cwd: dir,
      env: { ...bunEnv, CI: "false" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode, maxRSS: proc.resourceUsage()!.maxRSS };
  }

  test("fails every test with the file's name, leaves the file as it is, and reads it once", async () => {
    using dir = tempDir("snap-unparseable", { "a.test.ts": TEST_FILE });
    const snapPath = join(String(dir), "__snapshots__", "a.test.ts.snap");
    expect((await runTest(String(dir))).exitCode).toBe(0);
    const intact = await runTest(String(dir));
    expect(intact.exitCode).toBe(0);

    // The tail a second writer leaves behind: an entry that never ends.
    const torn = fs.readFileSync(snapPath, "utf8") + "\nexports[`torn";
    fs.writeFileSync(snapPath, torn);

    const result = await runTest(String(dir));
    expect(result.stderr).toContain('Restore the snapshot file or run "bun test --update-snapshots"');
    expect(result.stderr.split(`error: Failed to parse snapshot file: ${snapPath}\n`)).toHaveLength(COUNT + 1);
    expect(result.stderr).not.toContain("Failed to snapshot value");
    expect(result.stderr).toContain(` ${COUNT} fail`);
    expect(result.exitCode).toBe(1);
    expect(fs.readFileSync(snapPath, "utf8")).toBe(torn);

    // Re-reading and re-parsing the file for every test used hundreds of megabytes for 300 tests.
    expect(result.maxRSS - intact.maxRSS).toBeLessThan((isASAN ? 128 : 64) * 1024 * 1024);
  });

  test("--update-snapshots replaces it", async () => {
    using dir = tempDir("snap-unparseable-update", { "a.test.ts": TEST_FILE });
    const snapPath = join(String(dir), "__snapshots__", "a.test.ts.snap");
    fs.mkdirSync(join(String(dir), "__snapshots__"));
    fs.writeFileSync(snapPath, "exports[`torn");

    const { stderr, exitCode } = await runTest(String(dir), "--update-snapshots");
    expect(stderr).not.toContain("Failed to parse snapshot file");
    expect(stderr).toContain(`snapshots: +${COUNT} added`);
    expect(exitCode).toBe(0);
    expect(fs.readFileSync(snapPath, "utf8").match(/^exports\[/gm)).toHaveLength(COUNT);
  });
});
