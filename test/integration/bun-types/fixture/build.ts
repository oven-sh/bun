import { expectAssignable, expectType } from "./utilities";

Bun.build({
  entrypoints: ["hey"],
  splitting: false,
});

// Build.CompileTarget should accept SIMD variants (issue #26247)
expectAssignable<Bun.Build.CompileTarget>("bun-linux-x64-modern");
expectAssignable<Bun.Build.CompileTarget>("bun-linux-x64-baseline");
expectAssignable<Bun.Build.CompileTarget>("bun-linux-arm64-modern");
expectAssignable<Bun.Build.CompileTarget>("bun-linux-arm64-baseline");
expectAssignable<Bun.Build.CompileTarget>("bun-linux-x64-modern-glibc");
expectAssignable<Bun.Build.CompileTarget>("bun-linux-x64-modern-musl");
expectAssignable<Bun.Build.CompileTarget>("bun-darwin-x64-modern");
expectAssignable<Bun.Build.CompileTarget>("bun-darwin-arm64-baseline");
expectAssignable<Bun.Build.CompileTarget>("bun-windows-x64-modern");

Bun.build({
  entrypoints: ["hey"],
  splitting: false,
  compile: {},
});

Bun.build({
  entrypoints: ["hey"],
  plugins: [
    {
      name: "my-terrible-plugin",
      setup(build) {
        expectType(build).is<Bun.PluginBuilder>();

        build.onResolve({ filter: /^hey$/ }, args => {
          expectType(args).is<Bun.OnResolveArgs>();

          return { path: args.path };
        });

        build.onLoad({ filter: /^hey$/ }, args => {
          expectType(args).is<Bun.OnLoadArgs>();

          return { contents: "hey", loader: "js" };
        });

        build.onStart(() => {});

        build.onEnd(result => {
          expectType(result).is<Bun.BuildOutput>();
          expectType(result.success).is<boolean>();
          expectType(result.outputs).is<Bun.BuildArtifact[]>();
          expectType(result.logs).is<Array<BuildMessage | ResolveMessage>>();
        });

        build.onBeforeParse(
          {
            namespace: "file",
            filter: /\.tsx$/,
          },
          {
            napiModule: {},
            symbol: "replace_foo_with_bar",
            // external: myNativeAddon.getSharedState()
          },
        );
      },
    },
  ],
});
