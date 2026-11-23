import type { BunPlugin, PluginBuilder, RuntimePluginBuilder } from "bun";
import { expectType } from "./utilities";

// Bun.plugin() passes a builder that has `target`, `onLoad`, `onResolve` and `module`, and nothing else.
Bun.plugin({
  name: "runtime",
  setup(build) {
    expectType(build).is<RuntimePluginBuilder>();
    expectType(build.target).is<"bun">();
    expectType(build.config).is<undefined>();

    build
      .onResolve({ filter: /^hey$/ }, args => ({ path: args.path }))
      .onLoad({ filter: /^hey$/ }, () => ({ contents: "hey", loader: "js" }))
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

// Bun.build() passes a builder that has `config` and the bundle hooks, and no `target`.
Bun.build({
  entrypoints: ["hey"],
  plugins: [
    {
      name: "bundler",
      setup(build) {
        expectType(build).is<PluginBuilder>();
        expectType(build.config.plugins).is<BunPlugin<PluginBuilder>[]>();

        build.config.minify = true;
        build.onStart(() => {});
        build.onEnd(result => {
          expectType(result).is<Bun.BuildOutput>();
        });

        // @ts-expect-error
        build.target;
      },
    },
  ],
});

// A plugin typed as a plain `BunPlugin` can go to both, so it starts with what both builders have.
{
  const shared: BunPlugin = {
    name: "shared",
    setup(build) {
      expectType(build).is<PluginBuilder | RuntimePluginBuilder>();

      build.onResolve({ filter: /^hey$/ }, args => ({ path: args.path }));
      build.onLoad({ filter: /^hey$/ }, () => ({ contents: "hey", loader: "js" }));

      // @ts-expect-error
      build.config.target;
      // @ts-expect-error
      build.onStart(() => {});
      // @ts-expect-error
      build.onEnd(() => {});
      // @ts-expect-error
      build.onBeforeParse({ filter: /\.tsx$/ }, { napiModule: {}, symbol: "replace_foo_with_bar" });
      // @ts-expect-error
      build.target;

      expectType(build.config?.target).is<Bun.Target | undefined>();
      build.onStart?.(() => {});

      if (build.config) {
        expectType(build).is<PluginBuilder>();
        build.config.conditions = ["hey"];
        build.onEnd(() => {});
      } else {
        expectType(build).is<RuntimePluginBuilder>();
        expectType(build.target).is<"bun">();
      }
    },
  };

  expectType(Bun.plugin(shared)).is<void | Promise<void>>();
  Bun.build({ entrypoints: ["hey"], plugins: [shared] });

  const factory = (): BunPlugin => ({
    name: "factory",
    async setup(build) {
      if (!build.config) return;
      build.onEnd(() => {});
    },
  });
  Bun.plugin(factory());
  Bun.build({ entrypoints: ["hey"], plugins: [factory()] });
}

// A plain `BunPlugin` does not take a `setup` that needs one builder.
{
  const needsTheBundler: BunPlugin = {
    name: "needs the bundler",
    // @ts-expect-error
    setup(build: PluginBuilder) {
      build.config.target;
    },
  };
  needsTheBundler;
}

// A plugin typed for one builder goes to the caller that passes that builder, and not to the other.
{
  const onlyBundler: BunPlugin<PluginBuilder> = {
    name: "only bundler",
    setup(build) {
      expectType(build).is<PluginBuilder>();
      build.config.target;
      build.onStart(() => {});
    },
  };
  Bun.build({ entrypoints: ["hey"], plugins: [onlyBundler] });
  // @ts-expect-error
  Bun.plugin(onlyBundler);

  const onlyRuntime: BunPlugin<RuntimePluginBuilder> = {
    name: "only runtime",
    setup(build) {
      expectType(build).is<RuntimePluginBuilder>();
      build.module("hey:there", () => ({ exports: {}, loader: "object" }));
    },
  };
  Bun.plugin(onlyRuntime);
  // @ts-expect-error
  Bun.build({ entrypoints: ["hey"], plugins: [onlyRuntime] });

  // @ts-expect-error
  const notShared: BunPlugin = onlyBundler;
  notShared;
}
