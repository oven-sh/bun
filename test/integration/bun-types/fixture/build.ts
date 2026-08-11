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

// Targets the runtime accepts and bun publishes: android and freebsd (added to the
// runtime in #29676), the npm package spelling with the libc before the SIMD level,
// and a pinned Bun version suffix.
expectAssignable<Bun.Build.CompileTarget>("bun-linux-arm64-android");
expectAssignable<Bun.Build.CompileTarget>("bun-linux-aarch64-android");
expectAssignable<Bun.Build.CompileTarget>("bun-linux-x64-android");
expectAssignable<Bun.Build.CompileTarget>("bun-linux-x64-modern-android");
expectAssignable<Bun.Build.CompileTarget>("bun-freebsd-x64");
expectAssignable<Bun.Build.CompileTarget>("bun-freebsd-arm64");
expectAssignable<Bun.Build.CompileTarget>("bun-freebsd-aarch64");
expectAssignable<Bun.Build.CompileTarget>("bun-linux-x64-musl-baseline");
expectAssignable<Bun.Build.CompileTarget>("bun-linux-arm64-musl-modern");
expectAssignable<Bun.Build.CompileTarget>("bun-linux-x64-v1.2.3");
expectAssignable<Bun.Build.CompileTarget>("bun-linux-x64-v1.10.0");
expectAssignable<Bun.Build.CompileTarget>("bun-linux-arm64-musl-v1.2.3");
expectAssignable<Bun.Build.CompileTarget>("bun-linux-x64-musl-baseline-v1.2.3");
expectAssignable<Bun.Build.CompileTarget>("bun-linux-arm64-android-v1.2.3");
expectAssignable<Bun.Build.CompileTarget>("bun-darwin-arm64-v1.2.3");
expectAssignable<Bun.Build.CompileTarget>("bun-windows-x64-baseline-v1.2.3");
expectAssignable<Bun.Build.CompileTarget>("bun-freebsd-x64-v1.2.3");

// Spellings the runtime rejects stay rejected.
// @ts-expect-error - android is a Linux libc, the runtime rejects it with any other OS
expectAssignable<Bun.Build.CompileTarget>("bun-windows-x64-android");
// @ts-expect-error - musl only exists on Linux
expectAssignable<Bun.Build.CompileTarget>("bun-freebsd-x64-musl");
// @ts-expect-error - the version suffix must be a complete major.minor.patch
expectAssignable<Bun.Build.CompileTarget>("bun-linux-x64-v1.2");
// @ts-expect-error - the version suffix starts with "v"
expectAssignable<Bun.Build.CompileTarget>("bun-linux-x64-1.2.3");
// @ts-expect-error - the version must be numeric
expectAssignable<Bun.Build.CompileTarget>("bun-linux-x64-vlatest");

Bun.build({
  entrypoints: ["hey"],
  compile: "bun-linux-arm64-android",
});

Bun.build({
  entrypoints: ["hey"],
  compile: {
    target: "bun-freebsd-x64-v1.2.3",
  },
});

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
