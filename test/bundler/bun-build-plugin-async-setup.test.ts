import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// `Bun.build({ plugins })` used to run each plugin's `setup()` during
// synchronous config parsing and, when `setup()` returned a promise that was
// still pending, spin the whole event loop (`waitForPromise`) until it
// settled. Synchronously re-entering the event loop from inside whatever
// callback called `Bun.build` is the bug class tracked in
// https://github.com/oven-sh/bun/issues/33261: a nested tick run from inside
// a ready-poll dispatch can clobber the shared ready-poll batch and lose
// one-shot events. It was also a deterministic hang on its own, because the
// nested loop blocks the very JS frame that would have settled the promise.
//
// `Bun.build` now returns without blocking: the remaining plugins and the
// rest of the config parse run in the pending promise's `.then` continuation.
describe("Bun.build with an async plugin setup()", () => {
  const entry = `export const hello = "world";\n`;

  test(
    "returns before a pending setup() promise settles",
    async () => {
      using dir = tempDir("bun-build-async-setup", {
        "entry.js": entry,
        "build-fixture.ts": /* ts */ `
          let release!: () => void;
          const gate = new Promise<void>(resolve => (release = resolve));
          const order: string[] = [];

          const built = Bun.build({
            entrypoints: ["./entry.js"],
            plugins: [
              {
                name: "gated",
                async setup(build) {
                  order.push("setup:start");
                  await gate;
                  order.push("setup:resume");
                  // A filter registered after the await must still be
                  // installed: they only take effect once setup() settles.
                  build.onLoad({ filter: /entry\\.js$/ }, () => ({
                    contents: "export const hello = 'patched';",
                    loader: "js",
                  }));
                },
              },
            ],
          });

          // Unreachable when Bun.build spins the event loop: release() is the
          // only thing that can settle the promise it would be waiting on.
          order.push("returned");
          release();

          const result = await built;
          order.push("built");
          if (!result.success) throw new AggregateError(result.logs, "build failed");
          const text = await result.outputs[0].text();
          if (!text.includes("patched")) {
            throw new Error("onLoad registered after an await was ignored:\\n" + text);
          }
          console.log(JSON.stringify(order));
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "build-fixture.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
        // Only reached when Bun.build blocks; the non-blocking path exits in
        // well under a second.
        timeout: 15_000,
        killSignal: "SIGKILL",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        proc.stdout.text(),
        proc.stderr.text(),
        proc.exited,
      ]);
      expect(exitCode === 0 ? JSON.parse(stdout.trim()) : { exitCode, stdout, stderr }).toEqual([
        "setup:start",
        "returned",
        "setup:resume",
        "built",
      ]);
    },
    30_000,
  );

  test("still waits for a setup() that suspends on I/O", async () => {
    using dir = tempDir("bun-build-async-setup-io", { "entry.js": entry });
    let setupResumed = false;
    const result = await Bun.build({
      entrypoints: [`${dir}/entry.js`],
      plugins: [
        {
          name: "sleepy",
          async setup() {
            await Bun.sleep(10);
            setupResumed = true;
          },
        },
      ],
    });
    expect(setupResumed).toBe(true);
    expect(result.success).toBe(true);
  });

  test("still waits for pending onStart() promises before loading any file", async () => {
    using dir = tempDir("bun-build-async-setup-onstart", { "entry.js": entry });
    const order: string[] = [];
    const result = await Bun.build({
      entrypoints: [`${dir}/entry.js`],
      plugins: [
        {
          name: "starter",
          setup(build) {
            build.onStart(async () => {
              await Bun.sleep(10);
              order.push("onStart");
            });
            build.onLoad({ filter: /entry\.js$/ }, () => {
              order.push("onLoad");
              return { contents: entry, loader: "js" };
            });
          },
        },
      ],
    });
    expect(result.success).toBe(true);
    expect(order).toEqual(["onStart", "onLoad"]);
  });

  test("runs the remaining plugins after an earlier async setup() settles", async () => {
    using dir = tempDir("bun-build-async-setup-chain", { "entry.js": entry });
    const order: string[] = [];
    const result = await Bun.build({
      entrypoints: [`${dir}/entry.js`],
      plugins: [
        {
          name: "first",
          async setup() {
            order.push("first:start");
            await Bun.sleep(10);
            order.push("first:done");
          },
        },
        {
          name: "second",
          setup() {
            order.push("second");
          },
        },
      ],
    });
    expect(result.success).toBe(true);
    expect(order).toEqual(["first:start", "first:done", "second"]);
  });

  test("config mutated after an await in setup() is respected", async () => {
    using dir = tempDir("bun-build-async-setup-mutate", {
      "entry.js": `export const flag = BUILD_FLAG;\n`,
    });
    const result = await Bun.build({
      entrypoints: [`${dir}/entry.js`],
      plugins: [
        {
          name: "definer",
          async setup(build) {
            await Bun.sleep(10);
            build.config.define = { BUILD_FLAG: JSON.stringify("after-await") };
          },
        },
      ],
    });
    expect(result.success).toBe(true);
    expect(await result.outputs[0].text()).toContain("after-await");
  });

  test("rejects the build promise when an async setup() rejects", async () => {
    using dir = tempDir("bun-build-async-setup-reject", { "entry.js": entry });
    await expect(
      Bun.build({
        entrypoints: [`${dir}/entry.js`],
        plugins: [
          {
            name: "explosive",
            async setup() {
              await Bun.sleep(10);
              throw new Error("setup exploded");
            },
          },
        ],
      }),
    ).rejects.toThrow("setup exploded");
  });
});
