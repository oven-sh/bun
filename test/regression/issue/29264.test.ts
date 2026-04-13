import { expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";
import { join } from "node:path";

// https://github.com/oven-sh/bun/issues/29264
//
// When a bundle plugin had an onResolve filter that matched one import but
// the same file also contained a non-external import that could not be
// resolved, the parse task finalized as an error without saving the parsed
// AST. A deferred onResolve plugin task later tried to read the importer's
// import_records from `graph.ast`, which was still at `JSAst.empty`, and
// crashed with "index out of bounds: index 0, len 0" (segfault in release).
test("#29264 bundler survives external + missing imports in same file", async () => {
  const dir = tempDirWithFiles("issue-29264", {
    "index.js": `
      import "src";
      import "./src";
    `,
  });

  let caught: any = null;
  try {
    await Bun.build({
      entrypoints: [join(dir, "index.js")],
      plugins: [
        {
          name: "mark-bare-external",
          setup(build) {
            build.onResolve({ filter: /^[^.]/ }, () => ({ external: true }));
          },
        },
      ],
    });
  } catch (e) {
    caught = e;
  }

  // Before the fix, the bundler segfaulted (release) or panicked with an
  // index-out-of-bounds (debug/ASAN) during the plugin onResolve callback
  // for "src" — never reaching the catch. Now it rejects with an
  // AggregateError whose `.errors` include the resolve failure for
  // "./src". We deliberately do NOT assert on the bare "src" import
  // because whether the plugin's `{ external: true }` (with no `path`)
  // falls through to a resolver error is plugin semantics, not what
  // this test guards against.
  expect(caught).not.toBeNull();
  const messages = (caught?.errors ?? []).map((e: any) => String(e?.message ?? e));
  expect(messages.some((m: string) => m.includes('Could not resolve: "./src"'))).toBe(true);
});
