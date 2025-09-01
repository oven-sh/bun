import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler worker simple", () => {
  itBundled("worker/SimpleTest", {
    files: {
      "/entry.js": `
        console.log("Hello world");
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
  });
});