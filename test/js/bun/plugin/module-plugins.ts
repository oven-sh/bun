import { plugin } from "bun";
plugin({
  name: "i am virtual!",
  setup(builder) {
    builder.module("my-virtual-module-async", async () => {
      // check
      await Bun.sleep(1);
      return {
        exports: {
          hello: "world",
        },
        loader: "object",
      };
    });

    builder.module("my-virtual-module-sync", () => {
      return {
        exports: {
          hello: "world",
        },
        loader: "object",
      };
    });

    builder.module("my-virtual-module-with-__esModule", () => {
      return {
        exports: {
          default: "world",
          __esModule: true,
        },
        loader: "object",
      };
    });

    builder.module("my-virtual-module-with-default", () => {
      return {
        exports: {
          default: "world",
        },
        loader: "object",
      };
    });

    builder.module("my-virtual-module-cjs-sync", () => ({
      contents: `globalThis.__cjsSyncSideEffect = 42; module.exports = { hello: "cjs-sync", named: 1 };`,
      loader: "js",
    }));

    builder.module("my-virtual-module-cjs-async", async () => {
      await Bun.sleep(1);
      return {
        contents: `globalThis.__cjsAsyncSideEffect = 99; module.exports = { hello: "cjs-async" };`,
        loader: "js",
      };
    });

    builder.module("my-virtual-module-cjs-exports-dot", () => ({
      contents: `exports.foo = "F"; exports.bar = "B";`,
      loader: "js",
    }));

    builder.module("my-virtual-module-cjs-throws", () => ({
      contents: `module.exports = {}; throw new Error("cjs body threw");`,
      loader: "js",
    }));

    builder.onResolve({ filter: /.*/, namespace: "onload-cjs" }, a => ({ path: a.path, namespace: "onload-cjs-load" }));
    builder.onLoad({ filter: /.*/, namespace: "onload-cjs-load" }, () => ({
      contents: `module.exports = { fromOnLoad: true };`,
      loader: "js",
    }));

    builder.onLoad({ filter: /.*/, namespace: "rejected-promise" }, async ({ path }) => {
      throw new Error("Rejected Promise");
    });

    builder.onResolve({ filter: /.*/, namespace: "rejected-promise2" }, ({ path }) => ({
      namespace: "rejected-promise2",
      path,
    }));

    builder.onLoad({ filter: /.*/, namespace: "rejected-promise2" }, ({ path }) => {
      return Promise.reject(new Error("Rejected Promise"));
    });
  },
});
