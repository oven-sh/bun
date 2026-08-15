import type { Loader } from "bun";
// Deliberately no `declare module` for "*.md" or "*.markdown" in extensions.d.ts: frameworks declare
// both themselves (astro/client.d.ts gives them a component default export), and a bun-types
// `export =` declaration merged into theirs silently turns their default export into a string.
// Projects that want the md loader's imports typed declare the modules themselves; here both imports
// fail to resolve and stay untyped.
// @ts-expect-error
import markdown from "./README.markdown";
// @ts-expect-error
import html from "./README.md";
import { expectAssignable, expectType } from "./utilities";

// The bundler implements json5 and md and accepts them by name (`bun build --loader`,
// `Bun.build({ loader })`, plugin onLoad results), so they are members of the union.
expectAssignable<Loader>("json5");
expectAssignable<Bun.Loader>("md");
// @ts-expect-error
expectAssignable<Loader>("bogus");

expectType(html).is<any>();
expectType(markdown).is<any>();

Bun.build({
  entrypoints: ["hey"],
  loader: {
    ".json5": "json5",
    ".md": "md",
  },
});

Bun.build({
  entrypoints: ["hey"],
  plugins: [
    {
      name: "loader-names",
      setup(build) {
        build.onLoad({ filter: /\.(json5|md)$/ }, args => {
          // `args.loader` is the default loader for the file, so it is "json5" or "md" here;
          // comparing against a name missing from the union is a no-overlap error.
          if (args.loader === "json5") {
            return { contents: "{ a: 1, }", loader: "json5" };
          }

          return { contents: "# heading", loader: "md" };
        });

        build.onEnd(result => {
          for (const output of result.outputs) {
            if (output.loader === "json5" || output.loader === "md") {
              expectType(output).is<Bun.BuildArtifact>();
            }
          }
        });
      },
    },
  ],
});

// Runtime plugins return the same OnLoadResult.
Bun.plugin({
  name: "markdown",
  setup(build) {
    build.onLoad({ filter: /\.md$/ }, () => ({ contents: "# heading", loader: "md" }));
  },
});
