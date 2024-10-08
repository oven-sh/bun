import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  itBundled("footer/CommentFooter", {
    footer: "// developed with love in SF",
    files: {
      "/a.js": `console.log("Hello, world!")`,
    },
    onAfterBundle(api) {
      api.expectFile("out.js").toContain("// developed with love in SF");
    },
  });
  itBundled("footer/MultilineFooter", {
    footer: `/**
 * This is copyright of [...] ${new Date().getFullYear()}
 * do not redistribute without consent of [...]
*/`,
    files: {
      "index.js": `console.log("Hello, world!")`,
    },
    onAfterBundle(api) {
      api.expectFile("out.js").toContain(`/**
 * This is copyright of [...] ${new Date().getFullYear()}
 * do not redistribute without consent of [...]
*/`);
    },
  });
});
