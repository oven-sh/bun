// Which framework route the dev server serves a URL with (`fileSystemRouterTypes[n]` options included).
import { Bake } from "bun";
import { devTest, minimalFramework } from "../bake-harness";

/** `minimalFramework` with one router type per entry, each overriding the minimal router type's options. */
function frameworkWithRouterTypes(...types: Partial<Bake.FrameworkFileSystemRouterType>[]): Bake.Framework {
  const [minimalType] = minimalFramework.fileSystemRouterTypes!;
  return {
    ...minimalFramework,
    fileSystemRouterTypes: types.map(options => ({ ...minimalType, ...options })),
  };
}

const page = (text: string) => `export default () => new Response(${JSON.stringify(text)});`;

devTest("the most specific dynamic route serves the request", {
  framework: minimalFramework,
  files: {
    "routes/[...all].ts": page("[...all]"),
    "routes/[slug].ts": page("[slug]"),
    "routes/[slug]/[id].ts": page("[slug]/[id]"),
    "routes/[team]/docs/[[...path]].ts": page("[team]/docs/[[...path]]"),
    "routes/opt/[[...rest]].ts": page("opt/[[...rest]]"),
  },
  async test(dev) {
    await dev.fetch("/a").equals("[slug]");
    await dev.fetch("/a/b").equals("[slug]/[id]");
    await dev.fetch("/a/b/c").equals("[...all]");
    await dev.fetch("/acme/docs").equals("[team]/docs/[[...path]]");
    await dev.fetch("/acme/docs/intro").equals("[team]/docs/[[...path]]");
    await dev.fetch("/opt").equals("opt/[[...rest]]");
    await dev.fetch("/opt/a").equals("opt/[[...rest]]");
  },
});

devTest("ignoreDirs skips directories whose name is listed", {
  framework: frameworkWithRouterTypes({ ignoreDirs: ["hidden", "also-hidden"] }),
  files: {
    "routes/index.ts": page("index"),
    "routes/hidden/index.ts": page("hidden"),
    "routes/also-hidden/index.ts": page("also-hidden"),
    "routes/visible/index.ts": page("visible"),
    "routes/visible/hidden/index.ts": page("visible/hidden"),
    "routes/hidden-suffix/index.ts": page("hidden-suffix"),
    "routes/node_modules/index.ts": page("node_modules"),
  },
  async test(dev) {
    await dev.fetch("/").equals("index");
    await dev.fetch("/visible").equals("visible");
    await dev.fetch("/hidden").expect404();
    await dev.fetch("/also-hidden").expect404();
    // Matched at any depth, not only directly under the root.
    await dev.fetch("/visible/hidden").expect404();
    // Compared against the whole directory name, not as a prefix.
    await dev.fetch("/hidden-suffix").equals("hidden-suffix");
    // Like `extensions`, a configured list replaces the default one instead of extending it.
    await dev.fetch("/node_modules").equals("node_modules");
  },
});

devTest("ignoreDirs is read from each router type", {
  framework: frameworkWithRouterTypes(
    { root: "routes-a", ignoreDirs: ["skip-a"] },
    { root: "routes-b", ignoreDirs: ["skip-b"] },
  ),
  files: {
    "routes-a/skip-a/one.ts": page("a: skip-a/one"),
    "routes-a/skip-b/two.ts": page("a: skip-b/two"),
    "routes-b/skip-a/three.ts": page("b: skip-a/three"),
    "routes-b/skip-b/four.ts": page("b: skip-b/four"),
  },
  async test(dev) {
    await dev.fetch("/skip-a/one").expect404();
    await dev.fetch("/skip-b/two").equals("a: skip-b/two");
    await dev.fetch("/skip-a/three").equals("b: skip-a/three");
    await dev.fetch("/skip-b/four").expect404();
  },
});

devTest("ignoreDirs defaults to node_modules and .git", {
  framework: minimalFramework,
  files: {
    "routes/index.ts": page("index"),
    "routes/other/index.ts": page("other"),
    "routes/node_modules/index.ts": page("node_modules"),
    "routes/.git/index.ts": page(".git"),
  },
  async test(dev) {
    await dev.fetch("/").equals("index");
    await dev.fetch("/other").equals("other");
    await dev.fetch("/node_modules").expect404();
    await dev.fetch("/.git").expect404();
  },
});
