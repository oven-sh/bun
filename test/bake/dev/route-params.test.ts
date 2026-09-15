// Route params tests cover the `params` object the dev server hands to a framework.
import { devTest, minimalFramework } from "../bake-harness";

// A file named `[0].ts` gives a route parameter whose name is a canonical array
// index. The params object has to keep it in its indexed storage, or
// Object.keys() lists a key that `params[0]` cannot read.
devTest("a param named like an array index is stored under the index", {
  framework: minimalFramework,
  files: {
    "routes/[0].ts": `
      export default function (req, meta) {
        const params = meta.params;
        return Response.json({
          keys: Object.keys(params),
          byIndex: params[0],
          byString: params["0"],
        });
      }
    `,
    "routes/posts/[...0].ts": `
      export default function (req, meta) {
        const params = meta.params;
        return Response.json({
          keys: Object.keys(params),
          byIndex: params[0],
        });
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/hello").equals({ keys: ["0"], byIndex: "hello", byString: "hello" });
    await dev.fetch("/posts/a/b").equals({ keys: ["0"], byIndex: ["a", "b"] });
  },
});
