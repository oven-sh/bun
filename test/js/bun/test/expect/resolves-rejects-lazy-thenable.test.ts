import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/40949
// `expect(value).rejects`/`.resolves` must resolve the value through its own
// `then()`, like `await` and Jest do. A Promise subclass that only starts its
// work inside an overridden `then()` (the shape of Bun.SQL's Query) otherwise
// never settles and the whole run hangs, so the assertions run in a child
// process with a kill timeout.
test(
  "expect().rejects/.resolves settle a Promise subclass with a lazy then()",
  async () => {
    using dir = tempDir("expect-lazy-thenable", {
      "lazy.test.ts": `
        import { expect, test } from "bun:test";

        class LazyQuery<T> extends Promise<T> {
          started = false;
          #work: (resolve: (v: T) => void, reject: (e: Error) => void) => void;
          #resolve!: (v: T) => void;
          #reject!: (e: Error) => void;
          constructor(work: (resolve: (v: T) => void, reject: (e: Error) => void) => void) {
            let _resolve: (v: T) => void;
            let _reject: (e: Error) => void;
            super((resolve, reject) => {
              _resolve = resolve;
              _reject = reject;
            });
            this.#resolve = _resolve!;
            this.#reject = _reject!;
            this.#work = work;
          }
          then(onfulfilled?: any, onrejected?: any): any {
            if (!this.started) {
              this.started = true;
              queueMicrotask(() => this.#work(this.#resolve, this.#reject));
            }
            return super.then(onfulfilled, onrejected);
          }
          static get [Symbol.species]() {
            return Promise;
          }
        }

        test("rejects", async () => {
          await expect(new LazyQuery((_, reject) => reject(new Error("boom")))).rejects.toThrow("boom");
        });

        test("resolves", async () => {
          await expect(new LazyQuery<number>(resolve => resolve(42))).resolves.toBe(42);
        });

        test("rejects mismatch still reports a resolved promise", async () => {
          let threw: Error | undefined;
          try {
            await expect(new LazyQuery<number>(resolve => resolve(1))).rejects.toBe(1);
          } catch (e) {
            threw = e as Error;
          }
          expect(threw?.message).toContain("Expected promise that rejects");
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "lazy.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      // Without the fix the child hangs forever (the per-test timeout never
      // interrupts the internal wait), so cap its lifetime.
      timeout: 60_000,
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("3 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  },
  // The child is a whole debug-build test run; the default 5s flakes in CI.
  90_000,
);
