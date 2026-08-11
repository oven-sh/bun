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

// BuildConfig.metafile accepts every form the runtime accepts: a boolean, a path
// for the JSON metafile, or separate paths for the JSON and markdown metafiles.
expectAssignable<Bun.BuildConfig["metafile"]>(true);
expectAssignable<Bun.BuildConfig["metafile"]>("meta.json");
expectAssignable<Bun.BuildConfig["metafile"]>({ json: "meta.json" });
expectAssignable<Bun.BuildConfig["metafile"]>({ markdown: "meta.md" });
expectAssignable<Bun.BuildConfig["metafile"]>({ json: "meta.json", markdown: "meta.md" });
// @ts-expect-error - only json and markdown can be written
expectAssignable<Bun.BuildConfig["metafile"]>({ yaml: "meta.yaml" });

Bun.build({
  entrypoints: ["hey"],
  outdir: "out",
  metafile: "meta.json",
});

Bun.build({
  entrypoints: ["hey"],
  outdir: "out",
  metafile: { json: "meta.json", markdown: "meta.md" },
}).then(result => {
  expectType(result.metafile).is<Bun.BuildMetafile | undefined>();
  for (const output of result.outputs) {
    if (output.kind === "metafile-json" || output.kind === "metafile-markdown") {
      expectType(output.path).is<string>();
    }
  }
});
