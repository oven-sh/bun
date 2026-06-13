import { expectAssignable, expectType } from "./utilities";

Bun.build({
  entrypoints: ["hey"],
  splitting: false,
});

Bun.build({
  entrypoints: ["hey"],
  moduleFederation: {
    name: "host",
    filename: "remoteEntry.js",
    exposes: {
      "./Button": "./src/Button.tsx",
      "./Card": { import: ["./src/Card.tsx"], name: "Card" },
    },
    remotes: {
      remote: "remote@http://localhost:3001/remoteEntry.js",
      other: {
        external: ["other@http://localhost:3002/remoteEntry.js"],
        shareScope: "default",
      },
      manifestRemote: {
        manifest: "http://localhost:3003/mf-manifest.json",
        type: "script",
        name: "manifestRemote",
      },
      manifestObjectRemote: {
        manifest: { remoteEntry: { path: "remoteEntry.js", type: "module" } },
      },
    },
    shared: {
      react: { singleton: true, requiredVersion: "^19.0.0" },
      "react-dom": false,
      lodash: "lodash-es",
    },
    manifest: { fileName: "mf-manifest.json", disableAssetsAnalyze: true },
    runtimePlugins: ["./runtime-plugin.ts", ["./runtime-plugin-with-options.ts", { flag: true }]],
    shareStrategy: "version-first",
    experiments: { asyncStartup: true },
  },
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
