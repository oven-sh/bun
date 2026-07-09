import { describe, expect } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  itBundled("footer/CommentFooter", {
    footer: "// developed with love in SF",
    backend: "cli",
    files: {
      "/a.js": `console.log("Hello, world!")`,
    },
    onAfterBundle(api) {
      api.expectFile("out.js").toEndWith('// developed with love in SF"\n');
    },
  });
  itBundled("footer/MultilineFooter", {
    footer: `/**
 * This is copyright of [...] ${new Date().getFullYear()}
 * do not redistribute without consent of [...]
*/`,
    backend: "cli",
    files: {
      "index.js": `console.log("Hello, world!")`,
    },
    onAfterBundle(api) {
      api.expectFile("out.js").toEndWith(`/**
 * This is copyright of [...] ${new Date().getFullYear()}
 * do not redistribute without consent of [...]
*/\"\n`);
    },
  });
  itBundled("footer/NonAsciiFooterTargetBun", {
    footer: 'console.log("f:pié🚀", "f:pié🚀".length);',
    target: "bun",
    files: {
      "/a.js": `console.log("entry");`,
    },
    onAfterBundle(api) {
      const content = api.readFile("out.js");
      expect(content).toStartWith("// @bun\n");
      expect(content).toContain('console.log("f:pié🚀", "f:pié🚀".length);');
    },
    run: { stdout: "entry\nf:pié🚀 7" },
  });
});
