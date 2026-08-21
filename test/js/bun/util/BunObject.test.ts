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

test("a lazy property whose builtin fails to load throws from the read", async () => {
  // The shell builtin ($) and the sql module body (sql, SQL, postgres) call Symbol(), so
  // breaking it makes each builder throw. The read must throw that error (debug builds used to
  // report the still-pending exception from inside the sql builders and abort) and the slot
  // must stay unreified so a later read runs the builder again. On Windows the shell builtin also
  // builds process.env before it calls Symbol(), which reifies Bun.inspect, so there the throwing
  // read of $ transitions the Bun object mid-lookup as well: the case the next test sets up by hand.
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

test.concurrent("a lazy property builder that reifies another property of Bun and then throws", async () => {
  // The sql module body reads Error.prototype (class ... extends Error). The proxy makes that read
  // reify Bun.semver, which transitions the Bun object while the Bun.sql lookup is still running,
  // and then throw. Debug builds used to abort in the lookup's prototype step, which still held
  // the structure from before the transition (ASSERT in Structure::storedPrototype); the lookup now
  // ends as soon as the builder has thrown. "phase" 1 proves the trap ran: if the sql module stops
  // reading Error.prototype while it is evaluated, this test needs a new trigger.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const RealError = Error;
       let phase = 0;
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
       let thrown;
       try { Bun.sql; thrown = "no throw"; } catch (e) { thrown = e; }
       globalThis.Error = RealError;
       console.log(JSON.stringify([thrown, phase, typeof Bun.sql]));`,
    ],
    env: { ...bunEnv, BUN_JSC_validateExceptionChecks: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: JSON.stringify(["boom", 1, "function"]),
    stderr: "",
    exitCode: 0,
  });
});

// A read of an unreified lazy property whose builder throws has to end the lookup at the Bun
// object. It used to go on to Bun's prototype with the exception still pending. The Proxy put
// behind Bun here has its own getOwnPropertySlot, and running it with a pending exception is what
// BUN_JSC_validateExceptionChecks=1 aborts on in debug builds. Both prototype walk loops are
// covered: a plain receiver uses JSObject::getPropertySlot, and a receiver that overrides
// getOwnPropertySlot (a function) sends the rest of the walk through
// JSObject::getNonIndexPropertySlot. The second read, which lets the builder succeed, used to
// abort the same way through the function: that loop did not check after running a builder at all.
test.concurrent.each([
  ["Bun itself", "Bun"],
  ["a function that inherits from Bun", "Object.setPrototypeOf(function () {}, Bun)"],
])("a lazy property builder that throws ends the lookup when the receiver is %s", async (_, receiver) => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `Object.setPrototypeOf(Bun, new Proxy(Object.prototype, {}));
       const receiver = ${receiver};
       const RealSymbol = Symbol;
       globalThis.Symbol = NaN;
       let thrown;
       try { receiver.sql; thrown = "no throw"; } catch (e) { thrown = e.constructor.name; }
       globalThis.Symbol = RealSymbol;
       console.log(JSON.stringify([thrown, typeof receiver.sql]));`,
    ],
    env: { ...bunEnv, BUN_JSC_validateExceptionChecks: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: JSON.stringify(["TypeError", "function"]),
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("a lazy property builder that throws is not recorded as a missing property", async () => {
  // Each access site is trained on many object shapes first, so that it is megamorphic by the
  // time it sees Bun and the access takes the megamorphic slow path. That path used to walk past
  // the builder that threw and record "not present" for Bun's structure. A builder that throws
  // stores nothing, so Bun kept that structure and every later access from a megamorphic site got
  // undefined (false for `in`) instead of running the builder again. So the second access of each
  // site has to throw like the first one. Symbol stays broken throughout because the three sql
  // properties share one module, which would stop throwing once any of them loaded it. Each site
  // has its own property because the record is per property name.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const byValKey = "postgres";
       const inByValKey = "$";
       const sites = {
         get_by_id: o => typeof o.sql,
         get_by_val: o => typeof o[byValKey],
         in_by_id: o => "SQL" in o,
         in_by_val: o => inByValKey in o,
       };
       const shapes = [];
       for (let i = 0; i < 32; i++) {
         const o = { sql: 0, postgres: 0, SQL: 0, $: 0 };
         o["shape" + i] = i;
         shapes.push(o);
       }
       for (let i = 0; i < 200; i++) {
         for (const o of shapes) for (const name in sites) sites[name](o);
       }
       const access = site => { try { return site(Bun); } catch (e) { return e.constructor.name; } };
       const RealSymbol = Symbol;
       globalThis.Symbol = NaN;
       const results = {};
       for (const name in sites) results[name] = [access(sites[name]), access(sites[name])];
       globalThis.Symbol = RealSymbol;
       results.afterwards = typeof Bun.sql;
       console.log(JSON.stringify(results));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: JSON.stringify({
      get_by_id: ["TypeError", "TypeError"],
      get_by_val: ["TypeError", "TypeError"],
      in_by_id: ["TypeError", "TypeError"],
      in_by_val: ["TypeError", "TypeError"],
      afterwards: "function",
    }),
    stderr: "",
    exitCode: 0,
  });
});
