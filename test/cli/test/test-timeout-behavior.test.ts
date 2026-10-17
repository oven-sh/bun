import { expect, test } from "bun:test";
import { bunEnv, bunExe, isFlaky, isLinux, normalizeBunSnapshot, tempDir } from "harness";
import path from "path";

if (isFlaky && isLinux) {
  test.todo("processes get killed");
} else {
  test.concurrent.each([true, false])(`processes get killed (sync: %p)`, async sync => {
    const { exited, stdout, stderr } = Bun.spawn({
      cmd: [
        bunExe(),
        "test",
        path.join(import.meta.dir, sync ? "process-kill-fixture-sync.ts" : "process-kill-fixture.ts"),
      ],
      stdout: "pipe",
      stderr: "pipe",
      stdin: "inherit",
      env: bunEnv,
    });
    const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
    // merge outputs so that this test still works if we change which things are printed to stdout
    // and which to stderr
    const combined = out + err;
    // exit code should indicate failed tests, not abort or anything
    expect(exitCode).toBe(1);
    expect(combined).not.toContain("This should not be printed!");
    expect(combined).toContain("killed 1 dangling process");
    // we should not expose the termination exception
    expect(combined).not.toContain("Unhandled error between tests");
    expect(combined).not.toContain("JavaScript execution terminated");
    // both tests should have run with the expected result
    expect(combined).toContain("(fail) test timeout kills dangling processes");
    expect(combined).toContain("(pass) slow test after test timeout");
  });
}

for (const flags of [[], ["--parallel=2", "--no-isolate"]]) {
  for (const nested of [false, true]) {
    test.concurrent.each(["promise", "done", "throw"])(
      `hook failure labels (${flags.join(" ") || "serial"}, nested: ${nested}, failure: %s)`,
      async failure => {
        const done = failure === "done";
        const hooks = ["beforeAll", "beforeEach", "afterEach", "afterAll"];
        using dir = tempDir("hook-timeout-labels", {
          "passing.test.ts": `import { test } from "bun:test"; for (let i = 0; i < 21; i++) test("passing " + i, () => {});`,
          ...Object.fromEntries(
            hooks.map(hook => [
              `${hook}.test.ts`,
              `import { ${hook}, describe, test } from "bun:test";
${nested ? 'describe("suite", () => {' : ""}
${hook}(${failure === "throw" ? '() => { throw new Error("hook failed"); }' : done ? "(done) => {}" : "() => new Promise(() => {})"}, 10);
test("named test", () => {});
${nested ? "});" : ""}`,
            ]),
          ),
        });
        await using proc = Bun.spawn({
          cmd: [bunExe(), "test", ...flags, "--reporter=junit", "--reporter-outfile=report.xml"],
          env: { ...bunEnv, FORCE_COLOR: "0", AGENT: "0" },
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        const output = normalizeBunSnapshot(stderr, dir);
        const scope = nested ? "suite > " : "";
        const labels = hooks.map(hook =>
          hook.endsWith("All") ? `(fail) ${hook}.test.ts > ${scope}${hook}` : `(fail) ${scope}named test`,
        );
        expect(
          output
            .split("\n")
            .filter(line => line.startsWith("(fail)"))
            .sort(),
        ).toEqual([...labels, ...labels].sort());
        const messages =
          failure === "throw"
            ? []
            : hooks.map(
                hook =>
                  `^ the ${hook} hook timed out after 10ms${
                    done
                      ? ", before its done callback was called. If a done callback was not intended, remove the last parameter from the hook callback function"
                      : "."
                  }`,
              );
        expect(
          output
            .split("\n")
            .map(line => line.trim())
            .filter(line => line.startsWith("^ the "))
            .sort(),
        ).toEqual([...messages, ...messages].sort());
        expect(normalizeBunSnapshot(stdout, dir)).toBe(
          `bun test <version> (<revision>)${flags.length ? " 2x PARALLEL" : ""}`,
        );
        const junit = await Bun.file(path.join(String(dir), "report.xml")).text();
        expect([...junit.matchAll(/<testcase name="(beforeAll|afterAll)"/g)].map(match => match[1]).sort()).toEqual([
          "afterAll",
          "beforeAll",
        ]);
        expect(exitCode).toBe(1);
      },
    );
  }
}
