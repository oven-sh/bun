import { expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, tempDir, tmpdirSync } from "harness";
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

test("--update-snapshots keeps the old file until the new contents are written", async () => {
  const header = "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n";
  const before = header + '\nexports[`one 1`] = `"old"`;\n\nexports[`removed 1`] = `"old"`;\n';
  using dir = tempDir("snapshot-update-bail", {
    "a.test.ts": `
      import { test, expect } from "bun:test";
      test("one", () => { expect("new").toMatchSnapshot(); });
      test("fails", () => { expect(process.env.FAIL).toBeUndefined(); });
    `,
    "__snapshots__/a.test.ts.snap": before,
  });
  async function update(env: Record<string, string>) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--update-snapshots", "--bail"],
      cwd: String(dir),
      env: { ...bunEnv, CI: "false", ...env },
      stdout: "ignore",
      stderr: "ignore",
    });
    return { exitCode: await proc.exited, snap: fs.readFileSync(`${dir}/__snapshots__/a.test.ts.snap`, "utf8") };
  }
  expect(await update({ FAIL: "1" })).toEqual({ exitCode: 1, snap: before });
  expect(await update({})).toEqual({ exitCode: 0, snap: header + '\nexports[`one 1`] = `"new"`;\n' });
});

// bun test builds one parser for each inline snapshot it writes. Each sized its tables from the whole file.
test.concurrent("a new inline snapshot reserves no parser tables for the whole test file", async () => {
  const count = 128;
  const padding = Buffer.alloc(512 * 1024, "x").toString();
  const fixture = (snapshot: (i: number) => string) => `
    import { heapStats } from "bun:jsc";
    import { afterAll, expect, test } from "bun:test";
    // ${padding}
    let before = 0;
    afterAll(() => {
      before = heapStats().mimalloc.committed.peak;
    });
    // bun test writes the inline snapshots after the last test, and before this.
    process.on("exit", () => {
      console.log(JSON.stringify({ growth: heapStats().mimalloc.committed.peak - before }));
    });
    test("snapshots", () => {
      ${Array.from({ length: count }, (_, i) => `expect(${i}).toMatchInlineSnapshot(${snapshot(i)});`).join("\n      ")}
    });
  `;
  using dir = tempDir("inline-snapshot-presize", { "presize.test.ts": fixture(() => "") });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "./presize.test.ts"],
    // BUN_TEST_DRAIN_EVENT_LOOP: bun test runs the "exit" listeners of a test file.
    env: { ...bunEnv, CI: "false", BUN_TEST_DRAIN_EVENT_LOOP: "1" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const written = await Bun.file(join(String(dir), "presize.test.ts")).text();
  expect(stderr).toContain(`snapshots: +${count} added`);
  expect(written.replace(padding, "")).toBe(fixture(i => `\`${i}\``).replace(padding, ""));
  // stdout is the version line, then the line of the "exit" listener.
  const { growth } = JSON.parse(stdout.trim().split("\n").pop()!);
  // Each snapshot added about 5 times the file. Without that, the growth is a few times the file in total.
  expect(growth).toBeLessThan(count * padding.length);
  expect(exitCode).toBe(0);
});
