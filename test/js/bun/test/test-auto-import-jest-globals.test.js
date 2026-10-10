import { bunEnv, bunExe, tempDir } from "harness";

test("Jest auto imports", () => {
  expect(true).toBe(true);
  expect(typeof describe).toBe("function");
  expect(typeof it).toBe("function");
  expect(typeof test).toBe("function");
  expect(typeof expect).toBe("function");
  expect(typeof beforeAll).toBe("function");
  expect(typeof beforeEach).toBe("function");
  expect(typeof afterAll).toBe("function");
  expect(typeof afterEach).toBe("function");
});

// Injection is a `bun test`-mode parser transform (#17734 made it apply to every
// file loaded by the test runner, not just the entrypoint). The only remaining
// scoping guarantee is that ordinary `bun <file>` / `bun -e` runs do NOT see it.
describe("Jest globals are not injected outside of `bun test`", () => {
  const names = ["describe", "it", "test", "expect", "beforeAll", "beforeEach", "afterAll", "afterEach"];
  const source = `process.stdout.write(JSON.stringify({${names.map(n => `${n}: typeof ${n}`).join(", ")}}))`;
  const expected = Object.fromEntries(names.map(n => [n, "undefined"]));

  test.concurrent("bun -e", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(expected);
    expect(exitCode).toBe(0);
  });

  test.concurrent("bun <file>", async () => {
    using dir = tempDir("jest-globals-not-injected", { "entry.js": source });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(expected);
    expect(exitCode).toBe(0);
  });
});
