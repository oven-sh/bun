import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  itBundled("compile/CommentBanner", {
    banner: "// developed with love in SF",
    files: {
      "/a.js": `console.log("Hello, world!")`,
    },
    onAfterBundle(api) {
      api.expectFile("out.js").toContain("// developed with love in SF");
    },
  });
  itBundled("compile/MultilineBanner", {
    banner: `"use client";
// This is a multiline banner
// It can contain multiple lines of comments or code`,
    files: {
      /* js*/ "index.js": `console.log("Hello, world!")`,
    },
    onAfterBundle(api) {
      api.expectFile("out.js").toContain(`"use client";
// This is a multiline banner
// It can contain multiple lines of comments or code`);
    },
  });
  itBundled("compile/UseClientBanner", {
    banner: '"use client";',
    files: {
      /* js*/ "index.js": `console.log("Hello, world!")`,
    },
    onAfterBundle(api) {
      api.expectFile("out.js").toContain('"use client";');
    },
  });
});
