import { env } from "bun";
import { hasNonReifiedStatic } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
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

test("reifying every lazy property at once passes exception check validation", async () => {
  // { ...Bun } and Object.entries(Bun) run every PropertyCallback builder of the Bun object back
  // to back (JSObject::reifyAllStaticProperties). Builds with exception scope verification
  // (debug, ASAN) abort if one of them returns with an unchecked simulated throw; release
  // builds ignore the option, so there this only checks the copy is complete.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const spread = { ...Bun };
       const entries = Object.entries(Bun);
       const keys = Object.keys(Bun);
       const mismatched = keys.filter(key => !(key in spread) || spread[key] !== Bun[key]);
       console.log(JSON.stringify({ keys: keys.length > 0, entries: entries.length === keys.length, mismatched }));`,
    ],
    env: { ...bunEnv, BUN_JSC_validateExceptionChecks: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: JSON.stringify({ keys: true, entries: true, mismatched: [] }),
    stderr: "",
    exitCode: 0,
  });
});

test("a lazy property whose builtin fails to load throws from the read", async () => {
  // The shell builtin ($) and the sql module body (sql, SQL, postgres) call Symbol(), so
  // breaking it makes each builder throw. The read must throw that error (debug builds used to
  // report the still-pending exception from inside the sql builders and abort) and the slot
  // must stay unreified so a later read runs the builder again.
  //
  // process.env is read first because the shell builtin reads it before calling Symbol(), and
  // building it on Windows reifies another property of the Bun object; doing that in the middle
  // of the throwing read trips a separate structure assertion in debug builds.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `process.env;
       globalThis.Symbol = NaN;
       const results = {};
       for (const name of ["$", "sql", "SQL", "postgres"]) {
         results[name] = [];
         for (let i = 0; i < 2; i++) {
           try { Bun[name]; results[name].push("no throw"); } catch (e) { results[name].push(e.constructor.name); }
         }
       }
       console.log(JSON.stringify(results));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: JSON.stringify({
      $: ["TypeError", "TypeError"],
      sql: ["TypeError", "TypeError"],
      SQL: ["TypeError", "TypeError"],
      postgres: ["TypeError", "TypeError"],
    }),
    stderr: "",
    exitCode: 0,
  });
});
