import { env } from "bun";
import { hasNonReifiedStatic } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
test("hasNonReifiedStatic", () => {
  expect(hasNonReifiedStatic(Bun), "do not eagerly initialize the Bun object. This will make Bun much slower.").toBe(
    true,
  );
  expect(env.a).toBeUndefined();
  expect(hasNonReifiedStatic(Bun), "do not eagerly initialize the Bun object. This will make Bun much slower.").toBe(
    true,
  );
  const a = { ...Bun };
  globalThis.a = a;
  expect(hasNonReifiedStatic(Bun)).toBe(false);
});

test("require('bun')", () => {
  const str = eval("'bun'");
  expect(require(str)).toBe(Bun);
});

test("await import('bun')", async () => {
  const str = eval("'bun'");
  const BunESM = await import(str);

  // console.log it so that we iterate through all the fields and crash if it's
  // in an unexpected state.
  console.log(BunESM);

  for (let property in Bun) {
    expect(BunESM).toHaveProperty(property);
    expect(BunESM[property]).toBe(Bun[property]);
  }
  expect(BunESM.default).toBe(Bun);
});

// Bun.sql is initialized by running an internal module. Touching it for the
// first time with almost no stack left makes that initializer throw.
test.concurrent("Bun.sql initializer throwing does not crash or report an uncaught error", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        let result;
        function recurse() {
          try {
            recurse();
          } catch {}
          if (result === undefined) {
            try {
              Bun.sql;
              result = "initialized";
            } catch (e) {
              result = e.constructor.name;
            }
          }
        }
        recurse();
        console.log(JSON.stringify({ result, sql: typeof Bun.sql }));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ result: "RangeError", sql: "function" });
  expect(exitCode).toBe(0);
});

// Bun.$ is the first entry in the Bun object's property table and its
// initializer calls into JavaScript. Inspecting Bun with just enough stack for
// the formatter to start enumerating makes that initializer throw while the
// following entries are still initialized and printed.
test.concurrent("inspecting Bun while a lazy property initializer throws", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        let out;
        function recurse() {
          try {
            recurse();
          } catch {}
          if (out === undefined) {
            try {
              out = Bun.inspect(Bun, { depth: 0 });
            } catch {}
          }
        }
        recurse();
        console.log(JSON.stringify({ archive: out.includes("Archive:"), shell: out.includes("$:"), $: typeof Bun.$ }));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { shell, ...rest } = JSON.parse(stdout);
  expect(rest).toEqual({ archive: true, $: "function" });
  // On Windows the formatter's own stack headroom is larger than JSC's, so the
  // initializer never gets to fail there.
  if (!isWindows) expect(shell).toBe(false);
  expect(exitCode).toBe(0);
});
