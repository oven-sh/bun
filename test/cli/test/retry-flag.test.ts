import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

test("--retry retries failed tests", async () => {
  using dir = tempDir("retry-flag", {
    "flaky.test.ts": `
      import { test, expect } from "bun:test";
      let count = 0;
      test("flaky test", () => {
        count++;
        if (count < 3) throw new Error("fail attempt " + count);
        expect(true).toBe(true);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--retry", "3", "flaky.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("flaky test");
  expect(stderr).toContain("attempt 3");
  expect(exitCode).toBe(0);
});

test("per-test { retry } overrides --retry", async () => {
  using dir = tempDir("retry-override", {
    "override.test.ts": `
      import { test, expect } from "bun:test";
      let countA = 0;
      let countB = 0;

      // Per-test retry=1 overrides --retry 5. Fails twice, so retry=1 not enough.
      test("limited retry", { retry: 1 }, () => {
        countA++;
        if (countA < 3) throw new Error("fail attempt " + countA);
      });

      // Uses global --retry 5 default, fails once then passes.
      test("default retry", () => {
        countB++;
        if (countB < 2) throw new Error("fail attempt " + countB);
        expect(true).toBe(true);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--retry", "5", "override.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("limited retry");
  expect(stderr).toContain("default retry");
  expect(exitCode).not.toBe(0);
});

test("--retry works with describe blocks and beforeEach/afterEach hooks", async () => {
  using dir = tempDir("retry-hooks", {
    "hooks.test.ts": `
      import { test, expect, describe, beforeEach, afterEach } from "bun:test";
      let hookLog: string[] = [];
      let attempt = 0;

      describe("suite with hooks", () => {
        beforeEach(() => {
          hookLog.push("before");
        });

        afterEach(() => {
          hookLog.push("after");
        });

        test("flaky with hooks", () => {
          attempt++;
          hookLog.push("test:" + attempt);
          if (attempt < 3) throw new Error("fail attempt " + attempt);
          // On passing attempt, verify hooks ran each time
          expect(hookLog).toEqual([
            "before", "test:1", "after",
            "before", "test:2", "after",
            "before", "test:3",
          ]);
        });
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--retry", "3", "hooks.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("flaky with hooks");
  expect(exitCode).toBe(0);
});

test("--retry with multiple tests where only some need retries", async () => {
  using dir = tempDir("retry-multi", {
    "multi.test.ts": `
      import { test, expect } from "bun:test";
      let flakyCount = 0;

      test("always passes", () => {
        expect(1 + 1).toBe(2);
      });

      test("flaky test", () => {
        flakyCount++;
        if (flakyCount < 2) throw new Error("fail");
        expect(true).toBe(true);
      });

      test("always fails", () => {
        throw new Error("permanent failure");
      });

      test("another passing test", () => {
        expect("hello").toBe("hello");
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--retry", "3", "multi.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // "always fails" should still fail after all retries
  expect(exitCode).not.toBe(0);
  // Both passing tests and the flaky test should show as passing
  expect(stderr).toContain("always passes");
  expect(stderr).toContain("flaky test");
  expect(stderr).toContain("always fails");
  expect(stderr).toContain("another passing test");
});

test("--retry with async tests", async () => {
  using dir = tempDir("retry-async", {
    "async.test.ts": `
      import { test, expect } from "bun:test";
      let count = 0;

      test("async flaky test", async () => {
        count++;
        await Bun.sleep(1);
        if (count < 3) throw new Error("async fail attempt " + count);
        expect(true).toBe(true);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--retry", "3", "async.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("async flaky test");
  expect(stderr).toContain("attempt 3");
  expect(exitCode).toBe(0);
});

test("--retry with nested describe blocks", async () => {
  using dir = tempDir("retry-nested", {
    "nested.test.ts": `
      import { test, expect, describe, beforeEach } from "bun:test";
      let outerSetup = 0;
      let innerSetup = 0;
      let attempt = 0;

      describe("outer", () => {
        beforeEach(() => { outerSetup++; });

        describe("inner", () => {
          beforeEach(() => { innerSetup++; });

          test("deeply nested flaky", () => {
            attempt++;
            if (attempt < 2) throw new Error("fail");
            // Both outer and inner beforeEach should have run for each attempt
            expect(outerSetup).toBe(2);
            expect(innerSetup).toBe(2);
          });
        });
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--retry", "3", "nested.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("deeply nested flaky");
  expect(exitCode).toBe(0);
});

test("--retry with a large retry count still retries correctly", async () => {
  using dir = tempDir("retry-max", {
    "max.test.ts": `
      import { test, expect } from "bun:test";
      let count = 0;

      // Fails 19 times, passes on attempt 20
      test("fails many times", { retry: 20 }, () => {
        count++;
        if (count < 20) throw new Error("fail attempt " + count);
        expect(true).toBe(true);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "max.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("fails many times");
  expect(exitCode).toBe(0);
});

test("--retry with test.skip and test.todo does not retry them", async () => {
  using dir = tempDir("retry-skip-todo", {
    "skip-todo.test.ts": `
      import { test, expect } from "bun:test";

      test.skip("skipped test", () => {
        throw new Error("should not run");
      });

      test.todo("todo test");

      let count = 0;
      test("normal flaky", () => {
        count++;
        if (count < 2) throw new Error("fail");
        expect(true).toBe(true);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--retry", "3", "skip-todo.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("normal flaky");
  expect(stderr).toContain("skipped test");
  expect(stderr).toContain("todo test");
  expect(exitCode).toBe(0);
});

test("bunfig.toml retry works equivalently", async () => {
  using dir = tempDir("retry-bunfig", {
    "bunfig.toml": `
[test]
retry = 3
`,
    "flaky.test.ts": `
      import { test, expect } from "bun:test";
      let count = 0;
      test("flaky via bunfig", () => {
        count++;
        if (count < 3) throw new Error("fail attempt " + count);
        expect(true).toBe(true);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "flaky.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("flaky via bunfig");
  expect(stderr).toContain("attempt 3");
  expect(exitCode).toBe(0);
});

describe("snapshots of a retried test", () => {
  const imports = `import { test, expect, describe, beforeEach, afterEach } from "bun:test";\nlet attempt = 0;\n`;
  const snapshotFile = (entries: Record<string, string>) =>
    "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n" +
    Object.entries(entries)
      .map(([key, value]) => `\nexports[\`${key}\`] = \`${JSON.stringify(value)}\`;\n`)
      .join("");

  /** Runs `bun test` in a directory of `files`. Reports each test's result line, the snapshot summary and every file afterwards. */
  async function run(files: Record<string, string>, options: { args?: string[]; ci?: boolean } = {}) {
    using dir = tempDir("retry-snapshots", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...(options.args ?? [])],
      env: { ...bunEnv, CI: options.ci ? "true" : "false" },
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    const lines = stderr.split(/\r?\n/);
    const after: Record<string, string> = {};
    for (const name of Object.keys(files).concat(
      await Array.fromAsync(new Bun.Glob("__snapshots__/*").scan(String(dir))),
    )) {
      after[name.replaceAll("\\", "/")] = await Bun.file(join(String(dir), name)).text();
    }
    return {
      results: lines.filter(line => /^\((pass|fail)\)/.test(line)).map(line => line.replace(/ \[[\d.]+m?s\]$/, "")),
      conflicts: lines.filter(line => line.includes("Failed to update inline snapshot")).length,
      snapshots: lines.find(line => /^snapshots: |^ *\d+ snapshots, /.test(line))?.trim(),
      files: after,
      exitCode,
    };
  }

  const flaky = (matcher: string) => `${imports}test("flaky", () => {
  attempt++;
  ${matcher};
  if (attempt === 1) throw new Error("first attempt fails");
});
`;

  test.concurrent.each([
    {
      how: "{ retry: 1 }",
      args: [],
      edit: (source: string) => source.replace("});\n", "}, { retry: 1 });\n"),
      more: {},
    },
    { how: "--retry=1", args: ["--retry=1"], edit: (source: string) => source, more: {} },
    { how: "bunfig.toml", args: [], edit: (source: string) => source, more: { "bunfig.toml": "[test]\nretry = 1\n" } },
  ])("toMatchInlineSnapshot() writes the value of the attempt that passed ($how)", async ({ args, edit, more }) => {
    const source = (snapshot: string) => edit(flaky(`expect("value-" + attempt).toMatchInlineSnapshot(${snapshot})`));
    expect(await run({ "flaky.test.js": source(""), ...more }, { args })).toEqual({
      results: ["(pass) flaky (attempt 2)"],
      conflicts: 0,
      snapshots: "snapshots: +1 added",
      files: { "flaky.test.js": source('`"value-2"`'), ...more },
      exitCode: 0,
    });
  });

  test.concurrent("toThrowErrorMatchingInlineSnapshot() writes the message of the attempt that passed", async () => {
    const source = (snapshot: string) =>
      flaky(`expect(() => { throw new Error("message-" + attempt); }).toThrowErrorMatchingInlineSnapshot(${snapshot})`);
    expect(await run({ "flaky.test.js": source("") }, { args: ["--retry=1"] })).toEqual({
      results: ["(pass) flaky (attempt 2)"],
      conflicts: 0,
      snapshots: "snapshots: +1 added",
      files: { "flaky.test.js": source('`"message-2"`') },
      exitCode: 0,
    });
  });

  test.concurrent(
    "--update-snapshots replaces an inline snapshot with the value of the attempt that passed",
    async () => {
      const source = (snapshot: string) => flaky(`expect("value-" + attempt).toMatchInlineSnapshot(${snapshot})`);
      expect(await run({ "flaky.test.js": source('`"old"`') }, { args: ["--retry=1", "-u"] })).toEqual({
        results: ["(pass) flaky (attempt 2)"],
        conflicts: 0,
        snapshots: "1 snapshots, 1 expect() calls",
        files: { "flaky.test.js": source('`"value-2"`') },
        exitCode: 0,
      });
    },
  );

  test.concurrent(
    "--update-snapshots keeps an inline snapshot that only the failed attempt did not match",
    async () => {
      const source = `${imports}test("flaky", () => {
  attempt++;
  expect(attempt === 1 ? "half-initialised" : "right").toMatchInlineSnapshot(\`"right"\`);
  if (attempt === 1) throw new Error("first attempt fails");
}, { retry: 1 });
`;
      expect(await run({ "flaky.test.js": source }, { args: ["-u"] })).toEqual({
        results: ["(pass) flaky (attempt 2)"],
        conflicts: 0,
        snapshots: "1 snapshots, 1 expect() calls",
        files: { "flaky.test.js": source },
        exitCode: 0,
      });
    },
  );

  test.concurrent("an inline snapshot that only the failed attempt reached is not written", async () => {
    const source = (snapshot: string) => `${imports}test("flaky", () => {
  attempt++;
  if (attempt === 1) {
    expect("from the failed attempt").toMatchInlineSnapshot();
    throw new Error("first attempt fails");
  }
  expect("from the attempt that passed").toMatchInlineSnapshot(${snapshot});
}, { retry: 1 });
`;
    expect(await run({ "flaky.test.js": source("") })).toEqual({
      results: ["(pass) flaky (attempt 2)"],
      conflicts: 0,
      snapshots: "snapshots: +1 added",
      files: { "flaky.test.js": source('`"from the attempt that passed"`') },
      exitCode: 0,
    });
  });

  test.concurrent("the tests around a retried test keep their inline snapshots", async () => {
    const source = (before: string, flaky: string, after: string) => `${imports}test("before", () => {
  expect("before").toMatchInlineSnapshot(${before});
});
test("flaky", () => {
  attempt++;
  expect("value-" + attempt).toMatchInlineSnapshot(${flaky});
  if (attempt < 3) throw new Error("attempt fails");
}, { retry: 2 });
test("after", () => {
  expect("after").toMatchInlineSnapshot(${after});
});
`;
    expect(await run({ "flaky.test.js": source("", "", "") })).toEqual({
      results: ["(pass) before", "(pass) flaky (attempt 3)", "(pass) after"],
      conflicts: 0,
      snapshots: "snapshots: +3 added",
      files: { "flaky.test.js": source('`"before"`', '`"value-3"`', '`"after"`') },
      exitCode: 0,
    });
  });

  test.concurrent("inline snapshots taken in beforeEach and afterEach belong to the attempt", async () => {
    const source = (before: string, after: string) => `${imports}beforeEach(() => {
  attempt++;
  expect("before-" + attempt).toMatchInlineSnapshot(${before});
});
afterEach(() => {
  expect("after-" + attempt).toMatchInlineSnapshot(${after});
});
test("flaky", () => {
  if (attempt === 1) throw new Error("first attempt fails");
}, { retry: 1 });
`;
    expect(await run({ "flaky.test.js": source("", "") })).toEqual({
      results: ["(pass) flaky (attempt 2)"],
      conflicts: 0,
      snapshots: "snapshots: +2 added",
      files: { "flaky.test.js": source('`"before-2"`', '`"after-2"`') },
      exitCode: 0,
    });
  });

  test.concurrent("an expect() made outside the test body belongs to the attempt that calls its matcher", async () => {
    const source = (top: string, hook: string) => `${imports}const thrower = () => {
  throw new Error("message-" + attempt);
};
const madeWhileLoading = expect(thrower);
let madeInHook;
beforeEach(() => {
  madeInHook = expect(thrower);
});
test("flaky", () => {
  attempt++;
  madeWhileLoading.toThrowErrorMatchingInlineSnapshot(${top});
  madeInHook.toThrowErrorMatchingInlineSnapshot(${hook});
  if (attempt === 1) throw new Error("first attempt fails");
}, { retry: 1 });
`;
    expect(await run({ "flaky.test.js": source("", "") })).toEqual({
      results: ["(pass) flaky (attempt 2)"],
      conflicts: 0,
      snapshots: "snapshots: +2 added",
      files: { "flaky.test.js": source('`"message-2"`', '`"message-2"`') },
      exitCode: 0,
    });
  });

  test.concurrent("when every attempt fails, the last attempt's inline snapshot is written", async () => {
    const source = (snapshot: string) => `${imports}test("broken", () => {
  attempt++;
  expect("value-" + attempt).toMatchInlineSnapshot(${snapshot});
  throw new Error("every attempt fails");
}, { retry: 1 });
`;
    expect(await run({ "broken.test.js": source("") })).toEqual({
      results: ["(fail) broken (attempt 2)"],
      conflicts: 0,
      snapshots: "snapshots: +1 added",
      files: { "broken.test.js": source('`"value-2"`') },
      exitCode: 1,
    });
  });

  test.concurrent("two values at one call site in the attempt that passed are still a conflict", async () => {
    const source = `${imports}function check(value) {
  expect(value).toMatchInlineSnapshot();
}
test("flaky", () => {
  attempt++;
  check(1);
  check(2);
  if (attempt === 1) throw new Error("first attempt fails");
}, { retry: 1 });
`;
    expect(await run({ "flaky.test.js": source })).toEqual({
      results: ["(pass) flaky (attempt 2)"],
      conflicts: 1,
      snapshots: "snapshots: +1 added",
      files: { "flaky.test.js": source },
      exitCode: 1,
    });
  });

  test.concurrent("repeats that take different snapshots are still reported", async () => {
    const source = `${imports}test("inline", () => {
  expect("value-" + ++attempt).toMatchInlineSnapshot();
}, { repeats: 1 });
test("file", () => {
  expect("value-" + ++attempt).toMatchSnapshot();
}, { repeats: 1 });
`;
    expect(await run({ "repeats.test.js": source })).toEqual({
      results: ["(pass) inline (run 2)", "(fail) file (run 2)"],
      conflicts: 1,
      snapshots: "snapshots: +2 added, 1 failed",
      files: { "repeats.test.js": source, "__snapshots__/repeats.test.js.snap": snapshotFile({ "file 1": "value-3" }) },
      exitCode: 1,
    });
  });

  test.concurrent("--rerun-each keeps the snapshot of the attempt that passed in each run", async () => {
    const source = (snapshot: string) =>
      flaky(`expect("value-" + attempt).toMatchInlineSnapshot(${snapshot})`).replace("});\n", "}, { retry: 1 });\n");
    expect(await run({ "flaky.test.js": source("") }, { args: ["--rerun-each=2"] })).toEqual({
      results: ["(pass) flaky (attempt 2)", "(pass) flaky (attempt 2)"],
      conflicts: 0,
      snapshots: "snapshots: +1 added",
      files: { "flaky.test.js": source('`"value-2"`') },
      exitCode: 0,
    });
  });

  // The runner cannot tell which test of a concurrent group called the matcher.
  test.todo("a retried test in a concurrent group writes the inline snapshot of the attempt that passed", async () => {
    const source = (flaky: string, steady: string) => `${imports}test.concurrent("flaky", async () => {
  const mine = ++attempt;
  await null;
  expect("value-" + mine).toMatchInlineSnapshot(${flaky});
  if (mine === 1) throw new Error("first attempt fails");
}, { retry: 1 });
test.concurrent("steady", async () => {
  await null;
  expect("steady").toMatchInlineSnapshot(${steady});
});
`;
    expect((await run({ "flaky.test.js": source("", "") })).files).toEqual({
      "flaky.test.js": source('`"value-2"`', '`"steady"`'),
    });
  });

  test.concurrent("toMatchSnapshot() writes the value of the attempt that passed", async () => {
    const source = flaky(`expect("value-" + attempt).toMatchSnapshot()`);
    expect(await run({ "flaky.test.js": source }, { args: ["--retry=1"] })).toEqual({
      results: ["(pass) flaky (attempt 2)"],
      conflicts: 0,
      snapshots: "snapshots: +1 added",
      files: { "flaky.test.js": source, "__snapshots__/flaky.test.js.snap": snapshotFile({ "flaky 1": "value-2" }) },
      exitCode: 0,
    });
  });

  test.concurrent("every snapshot matcher of a test that passes on its third attempt", async () => {
    const source = (inline: string) => `${imports}test("flaky", () => {
  attempt++;
  expect("hinted-" + attempt).toMatchSnapshot("hint");
  expect("inline-" + attempt).toMatchInlineSnapshot(${inline});
  expect("plain-" + attempt).toMatchSnapshot();
  expect(() => { throw new Error("thrown-" + attempt); }).toThrowErrorMatchingSnapshot();
  if (attempt < 3) throw new Error("attempt fails");
}, { retry: 2 });
test("after", () => {
  expect("after").toMatchSnapshot();
});
`;
    expect(await run({ "flaky.test.js": source("") })).toEqual({
      results: ["(pass) flaky (attempt 3)", "(pass) after"],
      conflicts: 0,
      snapshots: "snapshots: +5 added",
      files: {
        "flaky.test.js": source('`"inline-3"`'),
        "__snapshots__/flaky.test.js.snap": snapshotFile({
          "flaky: hint 1": "hinted-3",
          "flaky 2": "plain-3",
          "flaky 3": "thrown-3",
          "after 1": "after",
        }),
      },
      exitCode: 0,
    });
  });

  test.concurrent("a snapshot that only the failed attempt took is not written to the .snap file", async () => {
    const source = `${imports}test("flaky", () => {
  attempt++;
  if (attempt === 1) expect("from the failed attempt").toMatchSnapshot();
  expect("steady").toMatchSnapshot();
  if (attempt === 1) throw new Error("first attempt fails");
}, { retry: 1 });
`;
    expect(await run({ "flaky.test.js": source })).toEqual({
      results: ["(pass) flaky (attempt 2)"],
      conflicts: 0,
      snapshots: "snapshots: +1 added",
      files: { "flaky.test.js": source, "__snapshots__/flaky.test.js.snap": snapshotFile({ "flaky 1": "steady" }) },
      exitCode: 0,
    });
  });

  test.concurrent("--update-snapshots replaces a .snap entry with the value of the attempt that passed", async () => {
    const source = flaky(`expect("value-" + attempt).toMatchSnapshot()`);
    const snap = "__snapshots__/flaky.test.js.snap";
    expect(
      await run({ "flaky.test.js": source, [snap]: snapshotFile({ "flaky 1": "old" }) }, { args: ["--retry=1", "-u"] }),
    ).toEqual({
      results: ["(pass) flaky (attempt 2)"],
      conflicts: 0,
      snapshots: "snapshots: +1 added",
      files: { "flaky.test.js": source, [snap]: snapshotFile({ "flaky 1": "value-2" }) },
      exitCode: 0,
    });
  });

  test.concurrent("when every attempt fails, the last attempt's .snap entry is written", async () => {
    const source = `${imports}test("broken", () => {
  expect("value-" + ++attempt).toMatchSnapshot();
  throw new Error("every attempt fails");
}, { retry: 1 });
`;
    expect(await run({ "broken.test.js": source })).toEqual({
      results: ["(fail) broken (attempt 2)"],
      conflicts: 0,
      snapshots: "snapshots: +1 added",
      files: { "broken.test.js": source, "__snapshots__/broken.test.js.snap": snapshotFile({ "broken 1": "value-2" }) },
      exitCode: 1,
    });
  });

  test.concurrent("a retried test takes its own .snap keys again, not those of a test with the same name", async () => {
    const source = `${imports}test("same name", () => {
  expect("first").toMatchSnapshot();
});
test("same name", () => {
  expect("second").toMatchSnapshot();
  if (++attempt === 1) throw new Error("first attempt fails");
}, { retry: 1 });
test("same name", () => {
  expect("third").toMatchSnapshot();
});
`;
    const snap = snapshotFile({ "same name 1": "first", "same name 2": "second", "same name 3": "third" });
    const results = ["(pass) same name", "(pass) same name (attempt 2)", "(pass) same name"];
    expect(await run({ "names.test.js": source })).toEqual({
      results,
      conflicts: 0,
      snapshots: "snapshots: +3 added",
      files: { "names.test.js": source, "__snapshots__/names.test.js.snap": snap },
      exitCode: 0,
    });
    // With the .snap file committed, the same run passes where snapshots cannot be created.
    expect(await run({ "names.test.js": source, "__snapshots__/names.test.js.snap": snap }, { ci: true })).toEqual({
      results,
      conflicts: 0,
      snapshots: "3 snapshots, 3 expect() calls",
      files: { "names.test.js": source, "__snapshots__/names.test.js.snap": snap },
      exitCode: 0,
    });
  });

  test.concurrent(
    "one flaky row of test.each under --retry does not renumber the .snap keys of the other rows",
    async () => {
      const source = `${imports}test.each(["a", "b", "c", "d"])("row", value => {
  expect(value).toMatchSnapshot();
  if (value === "b" && ++attempt === 1) throw new Error("first attempt fails");
});
`;
      const snap = snapshotFile({ "row 1": "a", "row 2": "b", "row 3": "c", "row 4": "d" });
      expect(
        await run(
          { "rows.test.js": source, "__snapshots__/rows.test.js.snap": snap },
          { args: ["--retry=1"], ci: true },
        ),
      ).toEqual({
        results: ["(pass) row", "(pass) row (attempt 2)", "(pass) row", "(pass) row"],
        conflicts: 0,
        snapshots: "4 snapshots, 4 expect() calls",
        files: { "rows.test.js": source, "__snapshots__/rows.test.js.snap": snap },
        exitCode: 0,
      });
    },
  );

  test.concurrent(".snap snapshots taken in beforeEach and afterEach belong to the attempt", async () => {
    const source = `${imports}let run = 0;
describe("hooks", () => {
  beforeEach(() => {
    expect("before-" + ++run).toMatchSnapshot();
  });
  afterEach(() => {
    expect("after-" + run).toMatchSnapshot();
  });
  test("steady", () => {});
  test("flaky", () => {
    expect("body-" + run).toMatchSnapshot();
    if (++attempt === 1) throw new Error("first attempt fails");
  }, { retry: 1 });
  test("last", () => {});
});
`;
    expect(await run({ "hooks.test.js": source })).toEqual({
      results: ["(pass) hooks > steady", "(pass) hooks > flaky (attempt 2)", "(pass) hooks > last"],
      conflicts: 0,
      snapshots: "snapshots: +7 added",
      files: {
        "hooks.test.js": source,
        "__snapshots__/hooks.test.js.snap": snapshotFile({
          "hooks (unnamed) 1": "before-1",
          "hooks (unnamed) 2": "after-1",
          "hooks (unnamed) 3": "before-3",
          "hooks flaky 1": "body-3",
          "hooks (unnamed) 4": "after-3",
          "hooks (unnamed) 5": "before-4",
          "hooks (unnamed) 6": "after-4",
        }),
      },
      exitCode: 0,
    });
  });

  test.concurrent("a mismatch in the failed attempt is not counted as a failed snapshot", async () => {
    const source = `${imports}test("flaky", () => {
  expect(++attempt === 1 ? "wrong" : "right").toMatchSnapshot();
  expect(attempt === 1 ? "wrong" : "right").toMatchInlineSnapshot(\`"right"\`);
}, { retry: 1 });
`;
    const snap = snapshotFile({ "flaky 1": "right" });
    expect(await run({ "flaky.test.js": source, "__snapshots__/flaky.test.js.snap": snap }, { ci: true })).toEqual({
      results: ["(pass) flaky (attempt 2)"],
      conflicts: 0,
      snapshots: "2 snapshots, 2 expect() calls",
      files: { "flaky.test.js": source, "__snapshots__/flaky.test.js.snap": snap },
      exitCode: 0,
    });
  });

  test.concurrent("a repeated test does not renumber the .snap keys of the tests around it", async () => {
    const source = `${imports}test("same name", () => {
  expect("first").toMatchSnapshot();
});
test("repeated", () => {
  expect("repeated").toMatchSnapshot();
}, { repeats: 2 });
test("same name", () => {
  expect("second").toMatchSnapshot();
});
`;
    expect(await run({ "names.test.js": source })).toEqual({
      results: ["(pass) same name", "(pass) repeated (run 3)", "(pass) same name"],
      conflicts: 0,
      snapshots: "snapshots: 2 passed, 3 added",
      files: {
        "names.test.js": source,
        "__snapshots__/names.test.js.snap": snapshotFile({
          "same name 1": "first",
          "repeated 1": "repeated",
          "same name 2": "second",
        }),
      },
      exitCode: 0,
    });
  });

  test.concurrent("a retried test in the second of two files", async () => {
    const first = `${imports}test("first file", () => {
  expect("first file").toMatchSnapshot();
});
`;
    const second = (inline: string) => `${imports}test("flaky", () => {
  attempt++;
  expect("inline-" + attempt).toMatchInlineSnapshot(${inline});
  expect("file-" + attempt).toMatchSnapshot();
  if (attempt === 1) throw new Error("first attempt fails");
}, { retry: 1 });
`;
    expect(
      await run({ "a.test.js": first, "b.test.js": second("") }, { args: ["./a.test.js", "./b.test.js"] }),
    ).toEqual({
      results: ["(pass) first file", "(pass) flaky (attempt 2)"],
      conflicts: 0,
      snapshots: "snapshots: +3 added",
      files: {
        "a.test.js": first,
        "b.test.js": second('`"inline-2"`'),
        "__snapshots__/a.test.js.snap": snapshotFile({ "first file 1": "first file" }),
        "__snapshots__/b.test.js.snap": snapshotFile({ "flaky 2": "file-2" }),
      },
      exitCode: 0,
    });
  });

  test.concurrent("--parallel workers write the snapshots of the attempt that passed", async () => {
    const source = (inline: string) =>
      flaky(`expect("inline-" + attempt).toMatchInlineSnapshot(${inline});
  expect("file-" + attempt).toMatchSnapshot()`);
    const { results, files, exitCode } = await run(
      { "a.test.js": source(""), "b.test.js": source("") },
      { args: ["--retry=1", "--parallel=2"] },
    );
    expect({ results: results.sort(), files, exitCode }).toEqual({
      results: ["(pass) flaky (attempt 2)", "(pass) flaky (attempt 2)"],
      files: {
        "a.test.js": source('`"inline-2"`'),
        "b.test.js": source('`"inline-2"`'),
        "__snapshots__/a.test.js.snap": snapshotFile({ "flaky 2": "file-2" }),
        "__snapshots__/b.test.js.snap": snapshotFile({ "flaky 2": "file-2" }),
      },
      exitCode: 0,
    });
  });
});
