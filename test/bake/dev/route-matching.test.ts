// Which framework route the dev server serves a URL with.
import { devTest, minimalFramework } from "../bake-harness";

const page = (name: string) => `export default () => new Response(${JSON.stringify(name)});`;

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
