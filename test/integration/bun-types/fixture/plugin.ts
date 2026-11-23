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

// `BunPlugin<Builder>` names the builder that `setup` receives.
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
}
