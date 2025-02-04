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
