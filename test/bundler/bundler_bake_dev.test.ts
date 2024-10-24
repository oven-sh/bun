import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", async () => {
  itBundled("bake_dev/HelloWorld", {
    todo: true,
    files: {
      "/a.js": `console.log("Hello, world!")`,
    },
    format: "internal_bake_dev",
    target: "bun",
    run: { stdout: "Hello, world!" },
    onAfterBundle(api) {
      // `importSync` is one of the functions the runtime includes.
      // it is on a property access so it will not be mangled
      api.expectFile("out.js").toContain("importSync");
    },
  });
  itBundled("bake_dev/SimpleCommonJS", {
    todo: true,
    files: {
      "/a.js": `console.log(require('./b').message)`,
      "/b.js": `module.exports = { message: "Hello, world!" }`,
    },
    format: "internal_bake_dev",
    target: "bun",
    run: { stdout: "Hello, world!" },
  });
  itBundled("bake_dev/SimpleESM", {
    todo: true,
    files: {
      "/a.js": `
        import message from './b';
        console.log(message);
      `,
      "/b.js": `export default "Hello, world!"`,
    },
    format: "internal_bake_dev",
    target: "bun",
    run: { stdout: "Hello, world!" },
  });
});
