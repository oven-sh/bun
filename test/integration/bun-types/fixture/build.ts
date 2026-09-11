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

          for (const log of result.logs) {
            // Both message classes extend Error and share the location getters.
            expectAssignable<Error>(log);
            expectType(log.cause).is<unknown>();
            expectType(log.position).is<Position | null>();
            expectType(log.line).is<number>();
            expectType(log.column).is<number>();
            expectType(log.toString()).is<string>();
            expectType(log[Symbol.toPrimitive]("default")).is<string>();
            expectType(log[Symbol.toPrimitive]("number")).is<string | null>();

            if (log instanceof ResolveMessage) {
              expectType(log.name).is<"ResolveMessage">();
              expectType(log.stack).is<string>();
              expectType(log.requireStack).is<string[] | undefined>();

              const json = log.toJSON();
              expectType(json.name).is<"ResolveMessage">();
              expectType(json.position).is<Position | null>();
              expectType(json.message).is<string>();
              expectType(json.level).is<ResolveMessage["level"]>();
              expectType(json.specifier).is<string>();
              expectType(json.importKind).is<ResolveMessage["importKind"]>();
              expectType(json.referrer).is<string>();
              // @ts-expect-error - toJSON() does not serialize code
              json.code;
              // @ts-expect-error - notes only exist on BuildMessage
              log.notes;
            } else {
              expectType(log).is<BuildMessage>();
              expectType(log.name).is<"BuildMessage">();
              // Inherited from Error: a BuildMessage has no stack of its own.
              expectType(log.stack).is<string | undefined>();
              expectType(log.notes).is<BuildMessage[]>();
              for (const note of log.notes) {
                expectType(note.level).is<BuildMessage["level"]>();
                expectType(note.position).is<Position | null>();
                expectType(note.notes).is<BuildMessage[]>();
              }

              const json = log.toJSON();
              expectType(json.name).is<"BuildMessage">();
              expectType(json.position).is<Position | null>();
              expectType(json.message).is<string>();
              expectType(json.level).is<BuildMessage["level"]>();
              // @ts-expect-error - toJSON() does not serialize notes
              json.notes;
              // @ts-expect-error - requireStack only exists on ResolveMessage
              log.requireStack;
            }
          }
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

// Failed imports and require() calls throw the same classes.
try {
  Bun.resolveSync("./missing", import.meta.dir);
} catch (e) {
  if (e instanceof ResolveMessage) {
    const requireStack: string[] = e.requireStack ?? [];
    const stack: string = e.stack;
    console.error(stack, requireStack, `${e.specifier} at ${e.line}:${e.column}`);
  } else if (e instanceof BuildMessage) {
    const error: Error = e;
    console.error(error.stack, e.notes.length, `${e.position?.file} at ${e.line}:${e.column}`);
  }
}
