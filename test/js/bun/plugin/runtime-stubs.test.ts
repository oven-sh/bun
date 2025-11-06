import { plugin } from "bun";
import { describe, expect, test } from "bun:test";

describe("Runtime plugin stubs", () => {
  test("onEnd throws clear error message", () => {
    expect(() => {
      plugin({
        name: "test-onend",
        setup(build) {
          build.onEnd(() => {
            // Should not reach here
          });
        },
      });
    }).toThrow("onEnd() is not supported for runtime plugins");
  });

  test("onDispose throws clear error message", () => {
    expect(() => {
      plugin({
        name: "test-ondispose",
        setup(build) {
          build.onDispose(() => {
            // Should not reach here
          });
        },
      });
    }).toThrow("onDispose() is not supported for runtime plugins yet");
  });

  test("resolve throws clear error message", () => {
    expect(() => {
      plugin({
        name: "test-resolve",
        setup(build) {
          build.resolve("./some-path", {});
        },
      });
    }).toThrow("resolve() is not implemented yet");
  });

  test("error messages are helpful", () => {
    try {
      plugin({
        name: "test-onend-message",
        setup(build) {
          build.onEnd(() => {});
        },
      });
    } catch (e: any) {
      expect(e.message).toContain("Bun.build()");
      expect(e.message).toContain("build process");
    }

    try {
      plugin({
        name: "test-ondispose-message",
        setup(build) {
          build.onDispose(() => {});
        },
      });
    } catch (e: any) {
      expect(e.message).toContain("no API to unload");
    }

    try {
      plugin({
        name: "test-resolve-message",
        setup(build) {
          build.resolve("./test");
        },
      });
    } catch (e: any) {
      expect(e.message).toContain("github.com");
      expect(e.message).toContain("2771");
    }
  });

  test("supported methods still work", () => {
    let onStartCalled = false;

    plugin({
      name: "test-supported",
      setup(build) {
        // These should all work
        build.onStart(() => {
          onStartCalled = true;
        });

        build.onLoad({ filter: /.*/, namespace: "test-stub" }, () => ({
          contents: "export const works = true;",
          loader: "js",
        }));

        build.onResolve({ filter: /.*/, namespace: "test-stub" }, ({ path }) => ({
          path,
          namespace: "test-stub",
        }));

        build.module("test-stub-module", () => ({
          exports: { supported: true },
          loader: "object",
        }));
      },
    });

    expect(onStartCalled).toBe(true);
  });

  test("methods exist and are functions", () => {
    plugin({
      name: "test-exists",
      setup(build) {
        // All methods should exist as functions
        expect(typeof build.onStart).toBe("function");
        expect(typeof build.onEnd).toBe("function");
        expect(typeof build.onDispose).toBe("function");
        expect(typeof build.resolve).toBe("function");
        expect(typeof build.onLoad).toBe("function");
        expect(typeof build.onResolve).toBe("function");
        expect(typeof build.module).toBe("function");
      },
    });
  });
});
