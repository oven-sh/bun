import { expect, test } from "bun:test";

import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";

test("expect.assertions causes the test to fail when it should", async () => {
  await using dir = tempDir("expect-assertions", {
    "expect-assertions.test.ts": await Bun.file(path.join(import.meta.dir, "expect-assertions-fixture.ts")).text(),
    "package.json": JSON.stringify({
      name: "expect-assertions",
      version: "0.0.0",
      scripts: {
        test: "bun test",
      },
    }),
  });

  const $$ = new Bun.$.Shell();
  $$.nothrow();
  $$.cwd(String(dir));
  $$.env(bunEnv);
  const result = await $$`${bunExe()} test`;

  console.log(result.stdout.toString());
  console.log(result.stderr.toString());

  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain("5 fail\n");
  expect(result.stderr.toString()).toContain("0 pass\n");
});

test("every matcher counts as one assertion, whether it passes or fails", async () => {
  using dir = tempDir("expect-assertions-count", {
    "count.test.js": `
      import { expect, mock, test } from "bun:test";

      const called = mock(x => x);
      called(1);
      const throws = () => {
        throw new Error("a");
      };
      function* calls() {
        for (const received of [1, "a", [1], { a: 1 }, called, throws])
          for (const args of [[], [1], ["a"], [[1]], [1, 2], ["a", 1], [Object], [called], ["number"]])
            for (const chain of [e => e, e => e.not]) yield name => chain(expect(received))[name](...args);
      }

      test("count", async () => {
        const counts = {};
        for (const [name, { value }] of Object.entries(Object.getOwnPropertyDescriptors(Object.getPrototypeOf(expect(0))))) {
          if (typeof value !== "function" || name === "constructor") continue;
          const counted = (counts[name] = {});
          for (const call of calls()) {
            const before = expect.getState().assertionCalls;
            let outcome = "passed";
            try {
              await call(name);
            } catch (error) {
              // An invalid argument is refused before or after the call is counted, depending on the matcher.
              if (!error.message.startsWith("expect(received)")) continue;
              outcome = "failed";
            }
            const count = expect.getState().assertionCalls - before;
            if (!(outcome in counted) || count !== 1) counted[outcome] = count;
            if ("passed" in counted && "failed" in counted) break;
          }
        }
        console.log(JSON.stringify(counts));
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test"],
    // With CI set, no snapshot is written, so the snapshot matchers only fail.
    env: { ...bunEnv, CI: "true", NO_COLOR: "1" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("1 pass");

  const counts = JSON.parse(stdout.trim().split("\n").at(-1)!);
  const names = Object.keys(counts);
  expect(names.length).toBeGreaterThanOrEqual(95);
  expect(counts).toEqual(
    Object.fromEntries(names.map(name => [name, name.endsWith("Snapshot") ? { failed: 1 } : { passed: 1, failed: 1 }])),
  );
  expect(exitCode).toBe(0);
});
