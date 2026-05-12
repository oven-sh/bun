// https://github.com/oven-sh/bun/issues/14670
//
// `expect($`...`).rejects.toThrow()` hung forever because ShellPromise is a
// lazy Promise subclass — it only starts the shell when `.then()` is called.
// `expect().resolves` / `.rejects` waited on the internal promise state
// directly without calling `.then()`, so the shell never ran and the promise
// never settled.
//
// These tests spawn a subprocess with a timeout so that unfixed builds fail
// cleanly instead of hanging the test runner.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function runTest(source: string) {
  using dir = tempDir("issue-14670", {
    "fixture.test.ts": source,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "fixture.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 20_000,
  });

  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  return { stderr, exitCode, signalCode: proc.signalCode };
}

test("expect($`...`).rejects.toThrow() does not hang", async () => {
  const { stderr, exitCode, signalCode } = await runTest(`
    import { expect, test } from "bun:test";
    import { $ } from "bun";

    test("shell rejects", async () => {
      await expect($\`definitely-not-a-real-command-14670\`.quiet()).rejects.toThrow();
    });
  `);

  expect(stderr).toContain("1 pass");
  expect(stderr).toContain("0 fail");
  expect(signalCode).toBeNull();
  expect(exitCode).toBe(0);
}, 30_000);

test("expect($`...`).resolves does not hang", async () => {
  const { stderr, exitCode, signalCode } = await runTest(`
    import { expect, test } from "bun:test";
    import { $ } from "bun";

    test("shell resolves", async () => {
      await expect($\`echo hi\`.quiet()).resolves.toHaveProperty("exitCode", 0);
    });
  `);

  expect(stderr).toContain("1 pass");
  expect(stderr).toContain("0 fail");
  expect(signalCode).toBeNull();
  expect(exitCode).toBe(0);
}, 30_000);

test("expect(() => $`...`).toThrow() does not hang", async () => {
  const { stderr, exitCode, signalCode } = await runTest(`
    import { expect, test } from "bun:test";
    import { $ } from "bun";

    test("shell fn toThrow", async () => {
      expect(() => $\`definitely-not-a-real-command-14670\`.quiet()).toThrow();
    });
  `);

  expect(stderr).toContain("1 pass");
  expect(stderr).toContain("0 fail");
  expect(signalCode).toBeNull();
  expect(exitCode).toBe(0);
}, 30_000);

test("expect(lazyPromiseSubclass).rejects does not hang", async () => {
  // Same bug without Bun Shell: any Promise subclass whose work is kicked
  // off in an overridden `.then()` would hang `expect().resolves/.rejects`.
  const { stderr, exitCode, signalCode } = await runTest(`
    import { expect, test } from "bun:test";

    class LazyReject extends Promise<never> {
      #started = false;
      #reject!: (e: unknown) => void;
      constructor() {
        let rej!: (e: unknown) => void;
        super((_, r) => { rej = r; });
        this.#reject = rej;
      }
      then(onfulfilled, onrejected) {
        if (!this.#started) {
          this.#started = true;
          setImmediate(() => this.#reject(new Error("boom")));
        }
        return super.then(onfulfilled, onrejected);
      }
      static get [Symbol.species]() { return Promise; }
    }

    test("lazy rejects", async () => {
      await expect(new LazyReject()).rejects.toThrow("boom");
    });
  `);

  expect(stderr).toContain("1 pass");
  expect(stderr).toContain("0 fail");
  expect(signalCode).toBeNull();
  expect(exitCode).toBe(0);
}, 30_000);
