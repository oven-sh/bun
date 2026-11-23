import type {
  BunPlugin,
  OnLoadArgs,
  OnLoadCallback,
  PluginBuilder,
  RuntimeOnLoadArgs,
  RuntimePlugin,
  RuntimePluginBuilder,
} from "bun";
import { expectType } from "./utilities";

// Bun.plugin() passes a builder that has `target`, `onLoad`, `onResolve` and `module`, and nothing else.
Bun.plugin({
  name: "runtime",
  setup(build) {
    expectType(build).is<RuntimePluginBuilder>();
    expectType(build.target).is<"bun">();
    expectType(build.config).is<undefined>();

    build
      .onResolve({ filter: /^hey$/ }, args => {
        expectType(args).is<Bun.OnResolveArgs>();
        return { path: args.path };
      })
      .onLoad({ filter: /^hey$/ }, async args => {
        // The runtime passes `path` and nothing else.
        expectType(args).is<RuntimeOnLoadArgs>();
        expectType(args.path).is<string>();
        // @ts-expect-error
        await args.defer();
        // @ts-expect-error
        args.namespace.length;
        return { contents: "hey", loader: "js" };
      })
      .module("hey:there", () => ({ exports: { hey: "there" }, loader: "object" }));

    // @ts-expect-error
    build.config.target;
    // @ts-expect-error
    build.onStart(() => {});
    // @ts-expect-error
    build.onEnd(() => {});
    // @ts-expect-error
    build.onBeforeParse({ filter: /\.tsx$/ }, { napiModule: {}, symbol: "replace_foo_with_bar" });
  },
});

// Bun.plugin() runs a plugin that has no `name`. Bun.build() throws for it.
Bun.plugin({
  setup(build) {
    expectType(build).is<RuntimePluginBuilder>();
  },
});
Bun.build({
  entrypoints: ["hey"],
  // @ts-expect-error
  plugins: [{ setup() {} }],
});

// Bun.build() passes a builder that has `config` and the bundle hooks, and no `target`.
Bun.build({
  entrypoints: ["hey"],
  plugins: [
    {
      name: "bundler",
      setup(build) {
        expectType(build).is<PluginBuilder>();

        build.config.minify = true;
        build.onStart(() => {});
        build.onLoad({ filter: /^hey$/ }, async args => {
          expectType(args).is<OnLoadArgs>();
          await args.defer();
          return { contents: "hey", loader: args.loader };
        });
        build.onEnd(result => {
          expectType(result).is<Bun.BuildOutput>();
        });

        // @ts-expect-error
        build.target;
      },
    },
  ],
});

// `RuntimePlugin` is the type of a plugin that only Bun.plugin() runs.
{
  const onlyRuntime: RuntimePlugin = {
    name: "only runtime",
    setup(build) {
      expectType(build).is<RuntimePluginBuilder>();
      build.module("hey:there", () => ({ exports: {}, loader: "object" }));
      // @ts-expect-error
      build.config.target;
    },
  };
  expectType(Bun.plugin(onlyRuntime)).is<void | Promise<void>>();
  // @ts-expect-error
  Bun.build({ entrypoints: ["hey"], plugins: [onlyRuntime] });
}

// A plugin typed as `BunPlugin` goes to both callers, and its `setup` is typed for the builder of Bun.build().
// So the compiler does not see that `build.config` is undefined in Bun.plugin().
{
  const shared: BunPlugin = {
    name: "shared",
    setup(build) {
      expectType(build).is<PluginBuilder>();
      build.config.target;
      build.onStart(() => {});
    },
  };
  expectType(Bun.plugin(shared)).is<void | Promise<void>>();
  Bun.build({ entrypoints: ["hey"], plugins: [shared] });

  const setup = (build: PluginBuilder) => {
    build.onEnd(() => {});
  };
  expectType(Bun.plugin({ name: "a setup() that is typed for Bun.build()", setup })).is<void>();

  // A type that is read off Bun.plugin() comes from its last signature, and stays `BunPlugin`.
  expectType<Parameters<typeof Bun.plugin>[0]>().is<BunPlugin>();
}

// An onLoad callback that is typed for Bun.build() goes to both builders. One that is written inline does not.
{
  const forBoth: OnLoadCallback = ({ path }) => ({ contents: path, loader: "text" });
  const readsTheNamespace = (args: OnLoadArgs) => ({ contents: args.namespace, loader: "text" as const });
  Bun.plugin({
    name: "callbacks that are typed for Bun.build()",
    setup(build) {
      build.onLoad({ filter: /^hey$/ }, forBoth).onLoad({ filter: /^hey$/ }, readsTheNamespace);
      // @ts-expect-error
      build.onLoad({ filter: /^hey$/ }, args => ({ contents: args.namespace.length + "", loader: "text" }));
      // @ts-expect-error
      build.onLoad({ filter: /^hey$/ }, () => ({ contents: 1 }));
    },
  });
  Bun.build({
    entrypoints: ["hey"],
    plugins: [{ name: "both", setup: build => void build.onLoad({ filter: /^hey$/ }, forBoth) }],
  });
}
