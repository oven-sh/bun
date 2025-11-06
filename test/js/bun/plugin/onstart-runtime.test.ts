import { plugin } from "bun";
import { describe, expect, test } from "bun:test";

describe("Bun.plugin onStart", () => {
  test("onStart callback is called synchronously", () => {
    let called = false;

    plugin({
      name: "test-onstart-sync",
      setup(build) {
        build.onStart(() => {
          called = true;
        });
      },
    });

    expect(called).toBe(true);
  });

  test("onStart callback can be async", async () => {
    let called = false;

    const promise = plugin({
      name: "test-onstart-async",
      setup(build) {
        build.onStart(async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          called = true;
        });
      },
    });

    // The promise should be returned
    expect(promise).toBeInstanceOf(Promise);
    await promise;
    expect(called).toBe(true);
  });

  test("onStart can set up state for plugins", async () => {
    let state: { ready: boolean } = { ready: false };

    await plugin({
      name: "test-onstart-state",
      setup(build) {
        build.onStart(async () => {
          // Simulate async initialization
          await new Promise(resolve => setTimeout(resolve, 5));
          state.ready = true;
        });

        build.onLoad({ filter: /.*/, namespace: "test-state" }, () => {
          if (!state.ready) {
            throw new Error("State not ready!");
          }
          return {
            contents: "export const value = 42;",
            loader: "js",
          };
        });

        build.onResolve({ filter: /.*/, namespace: "test-state" }, ({ path }) => ({
          path,
          namespace: "test-state",
        }));
      },
    });

    // The state should be ready now
    expect(state.ready).toBe(true);

    // And the plugin should work
    const mod = await import("test-state:value");
    expect(mod.value).toBe(42);
  });

  test("onStart returns builder for chaining", () => {
    plugin({
      name: "test-onstart-chaining",
      setup(build) {
        const result = build.onStart(() => {
          // no-op
        });
        expect(result).toBe(build);
      },
    });
  });

  test("onStart with rejected promise", async () => {
    const promise = plugin({
      name: "test-onstart-rejected",
      setup(build) {
        build.onStart(async () => {
          throw new Error("onStart failed!");
        });
      },
    });

    await expect(promise).rejects.toThrow("onStart failed!");
  });

  test("onStart throws if not given a function", () => {
    expect(() => {
      plugin({
        name: "test-onstart-invalid",
        setup(build) {
          // @ts-expect-error - testing runtime error
          build.onStart("not a function");
        },
      });
    }).toThrow("onStart() expects a function as first argument");
  });

  test("onStart throws if no callback provided", () => {
    expect(() => {
      plugin({
        name: "test-onstart-no-callback",
        setup(build) {
          // @ts-expect-error - testing runtime error
          build.onStart();
        },
      });
    }).toThrow("onStart() requires a callback function");
  });
});
