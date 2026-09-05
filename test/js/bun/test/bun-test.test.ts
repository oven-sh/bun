import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("Bun.version", () => {
  expect(process.versions.bun).toBe(Bun.version);
  expect(process.revision).toBe(Bun.revision);
});

test("expect().not.not", () => {
  // bun supports this but jest doesn't
  expect(1).not.not.toBe(1);
  expect(1).not.not.not.toBe(2);
});

// Fuzzer-found crash: Bun.jest() without an active test runner, followed by
// misuse of the expect statics, must not crash the process. In particular,
// `new` on a matcher registered via expect.extend() used to jump to a null
// native constructor and SIGSEGV.
test("Bun.jest() expect statics do not crash on misuse", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const jestExpect = Bun.jest().expect;
jestExpect.extend({ customMatcher() { return { pass: true, message: () => "" }; } });
try { new jestExpect.customMatcher(); } catch (e) { if (!(e instanceof TypeError)) throw e; }
try { new (jestExpect(1).customMatcher)(); } catch (e) { if (!(e instanceof TypeError)) throw e; }
try { jestExpect.extend(); } catch {}
const arrayContaining = jestExpect.arrayContaining;
try { new arrayContaining(); } catch (e) { if (!(e instanceof TypeError)) throw e; }
Bun.gc(true);
console.log("OK");`,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("OK\n");
  expect(exitCode).toBe(0);
});

// toBeWithin() with one argument used to index past the argument slice and
// abort the process instead of failing the test.
test("toBeWithin() with missing or non-number arguments fails the test without crashing", async () => {
  using dir = tempDir("to-be-within-args", {
    "within.test.ts": `
      import { test, expect } from "bun:test";

      test("one argument", () => {
        expect(1).toBeWithin(0);
      });

      test("no arguments", () => {
        expect(1).toBeWithin();
      });

      test("start is not a number", () => {
        expect(1).toBeWithin("0", 2);
      });

      test("end is not a number", () => {
        expect(1).toBeWithin(0, "2");
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "within.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("toBeWithin() requires 2 arguments");
  expect(stderr).toContain("toBeWithin() requires the first argument to be a number");
  expect(stderr).toContain("toBeWithin() requires the second argument to be a number");
  expect(stderr).toContain("4 fail");
  expect(exitCode).toBe(1);
});

// https://github.com/oven-sh/bun/issues/40949
// https://github.com/oven-sh/bun/issues/14670
// `.resolves` / `.rejects` used to wait on the internal promise state without
// calling the value's own then(). A Promise subclass that starts its work in
// then() (Bun.SQL's Query, Bun.$'s ShellPromise) never settled, and the test
// timeout could not interrupt the wait. The child is killed by `timeout` if
// that comes back.
test("expect(lazyPromiseSubclass).rejects settles instead of hanging the run", async () => {
  using dir = tempDir("expect-lazy-then", {
    "lazy.test.ts": `
      import { expect, test } from "bun:test";
      import { $, SQL } from "bun";

      class LazyQuery extends Promise<never> {
        started = false;
        #reject!: (e: Error) => void;
        constructor() {
          let reject!: (e: Error) => void;
          super((_, rej) => {
            reject = rej;
          });
          this.#reject = reject;
        }
        then(onFulfilled?: any, onRejected?: any): any {
          if (!this.started) {
            this.started = true;
            queueMicrotask(() => this.#reject(new Error("boom")));
          }
          return super.then(onFulfilled, onRejected);
        }
        static get [Symbol.species]() {
          return Promise;
        }
      }

      test("expect(lazy).rejects settles", async () => {
        await expect(new LazyQuery()).rejects.toThrow("boom");
      });

      test("Bun.$ ShellPromise", async () => {
        $.throws(true);
        await expect($\`exit 7\`.quiet()).rejects.toThrow(/exit code 7/);
        await expect($\`echo hi\`.quiet()).resolves.toMatchObject({ exitCode: 0 });
        expect(() => $\`exit 7\`.quiet()).toThrow(/exit code 7/);
      });

      test("Bun.SQL Query", async () => {
        await using sql = new SQL("sqlite://:memory:");
        await sql\`CREATE TABLE t (a INTEGER)\`;
        await sql\`INSERT INTO t VALUES (1)\`;
        await expect(sql\`SELECT a FROM t\`).resolves.toEqual([{ a: 1 }]);
        await expect(sql\`SELECT a FROM t\`.values()).resolves.toEqual([[1]]);
        await expect(sql\`SELECT * FROM no_such_table\`).rejects.toThrow(/no such table/);
        expect(() => sql\`SELECT * FROM no_such_table\`).toThrow(/no such table/);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "lazy.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10_000,
  });

  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // A hang is reported as the timeout kill, not as missing output.
  expect(proc.signalCode).toBeNull();
  expect(stderr).toContain("3 pass");
  expect(exitCode).toBe(0);
});
