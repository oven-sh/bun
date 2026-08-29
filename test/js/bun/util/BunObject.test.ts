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

// A lazy static-table property builder that reifies another lazy property on
// Bun (transitioning the object) and then throws used to trip
// ASSERT(object->structure() == this) in JSC::Structure::storedPrototype,
// because JSObject::getPropertySlot kept using the pre-transition structure
// for the prototype step. Here the bun:sql module evaluation inside the
// Bun.sql builder reads Error.prototype, which the proxy intercepts.
test("lazy property builder that transitions Bun and throws does not abort", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `let phase = 0;
globalThis.Error = new Proxy(function () {}, {
  get(target, key, receiver) {
    if (key === "prototype" && phase === 0) {
      phase = 1;
      Bun.semver;
      throw "boom";
    }
    return Reflect.get(target, key, receiver);
  },
});
let caught;
try {
  Bun.sql;
} catch (e) {
  caught = e;
}
console.log("caught:", caught, "phase:", phase);`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // "phase: 1" proves the builder re-entered the Bun object mid-lookup; if the
  // sql module stops reading Error.prototype at evaluation time, this test no
  // longer exercises the code path and needs a new trigger.
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "caught: boom phase: 1\n",
    stderr: "",
    exitCode: 0,
  });
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

test("a lazy property whose builtin fails to load throws from the read", async () => {
  // The shell builtin ($) and the sql module body (sql, SQL, postgres) call Symbol(), so
  // breaking it makes each builder throw. The read must throw that error (debug builds used to
  // report the still-pending exception from inside the sql builders and abort) and the slot
  // must stay unreified so a later read runs the builder again. On Windows the shell builtin also
  // builds process.env before it calls Symbol(), which reifies Bun.inspect, so there the throwing
  // read transitions the Bun object mid-lookup as well, the case the Error proxy test above sets
  // up by hand.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `globalThis.Symbol = NaN;
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
