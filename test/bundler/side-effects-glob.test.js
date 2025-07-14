import { itBundled } from "./expectBundled";
import { describe } from "bun:test";

describe("sideEffects with glob patterns", () => {
  itBundled("bundler/side-effects-glob/basic-glob", {
    files: {
      "/Users/user/project/src/index.js": /* js */ `
        import { used } from "./lib/used.js";
        import { unused } from "./lib/unused.js";
        import { sideEffectFile } from "./lib/side-effects/side-effect.js";
        console.log(used);
      `,
      "/Users/user/project/src/lib/used.js": /* js */ `
        export const used = "used";
      `,
      "/Users/user/project/src/lib/unused.js": /* js */ `
        export const unused = "unused";
      `,
      "/Users/user/project/src/lib/side-effects/side-effect.js": /* js */ `
        console.log("side effect");
        export const sideEffectFile = "side-effect";
      `,
      "/Users/user/project/package.json": /* json */ `
        {
          "name": "test-glob-side-effects",
          "sideEffects": ["src/lib/side-effects/*.js"]
        }
      `,
    },
    entryPoints: ["/Users/user/project/src/index.js"],
    outdir: "/Users/user/project/dist",
    bundleErrors: {},
    bundleWarnings: {},
    minifyWhitespace: false,
    run: {
      stdout: "used\nside effect",
    },
  });

  itBundled("bundler/side-effects-glob/wildcard-patterns", {
    files: {
      "/Users/user/project/src/index.js": /* js */ `
        import { used } from "./lib/used.js";
        import { unused } from "./lib/unused.js";
        import { sideEffectFile1 } from "./lib/side-effects/file1.js";
        import { sideEffectFile2 } from "./lib/side-effects/file2.js";
        import { normalFile } from "./lib/normal-file.js";
        console.log(used);
      `,
      "/Users/user/project/src/lib/used.js": /* js */ `
        export const used = "used";
      `,
      "/Users/user/project/src/lib/unused.js": /* js */ `
        export const unused = "unused";
      `,
      "/Users/user/project/src/lib/side-effects/file1.js": /* js */ `
        console.log("side effect 1");
        export const sideEffectFile1 = "side-effect-1";
      `,
      "/Users/user/project/src/lib/side-effects/file2.js": /* js */ `
        console.log("side effect 2");
        export const sideEffectFile2 = "side-effect-2";
      `,
      "/Users/user/project/src/lib/normal-file.js": /* js */ `
        export const normalFile = "normal";
      `,
      "/Users/user/project/package.json": /* json */ `
        {
          "name": "test-glob-side-effects",
          "sideEffects": ["src/lib/side-effects/*"]
        }
      `,
    },
    entryPoints: ["/Users/user/project/src/index.js"],
    outdir: "/Users/user/project/dist",
    bundleErrors: {},
    bundleWarnings: {},
    minifyWhitespace: false,
    run: {
      stdout: "used\nside effect 1\nside effect 2",
    },
  });

  itBundled("bundler/side-effects-glob/mixed-patterns", {
    files: {
      "/Users/user/project/src/index.js": /* js */ `
        import { used } from "./lib/used.js";
        import { unused } from "./lib/unused.js";
        import { sideEffectFile } from "./lib/side-effects/side-effect.js";
        import { specificFile } from "./lib/specific-file.js";
        console.log(used);
      `,
      "/Users/user/project/src/lib/used.js": /* js */ `
        export const used = "used";
      `,
      "/Users/user/project/src/lib/unused.js": /* js */ `
        export const unused = "unused";
      `,
      "/Users/user/project/src/lib/side-effects/side-effect.js": /* js */ `
        console.log("side effect");
        export const sideEffectFile = "side-effect";
      `,
      "/Users/user/project/src/lib/specific-file.js": /* js */ `
        console.log("specific file");
        export const specificFile = "specific";
      `,
      "/Users/user/project/package.json": /* json */ `
        {
          "name": "test-glob-side-effects",
          "sideEffects": [
            "src/lib/side-effects/*.js",
            "src/lib/specific-file.js"
          ]
        }
      `,
    },
    entryPoints: ["/Users/user/project/src/index.js"],
    outdir: "/Users/user/project/dist",
    bundleErrors: {},
    bundleWarnings: {},
    minifyWhitespace: false,
    run: {
      stdout: "used\nside effect\nspecific file",
    },
  });

  itBundled("bundler/side-effects-glob/question-mark-glob", {
    files: {
      "/Users/user/project/src/index.js": /* js */ `
        import { used } from "./lib/used.js";
        import { unused } from "./lib/unused.js";
        import { file1 } from "./lib/file1.js";
        import { file2 } from "./lib/file2.js";
        import { fileAB } from "./lib/fileAB.js";
        console.log(used);
      `,
      "/Users/user/project/src/lib/used.js": /* js */ `
        export const used = "used";
      `,
      "/Users/user/project/src/lib/unused.js": /* js */ `
        export const unused = "unused";
      `,
      "/Users/user/project/src/lib/file1.js": /* js */ `
        console.log("file1 side effect");
        export const file1 = "file1";
      `,
      "/Users/user/project/src/lib/file2.js": /* js */ `
        console.log("file2 side effect");
        export const file2 = "file2";
      `,
      "/Users/user/project/src/lib/fileAB.js": /* js */ `
        export const fileAB = "fileAB";
      `,
      "/Users/user/project/package.json": /* json */ `
        {
          "name": "test-glob-side-effects",
          "sideEffects": ["src/lib/file?.js"]
        }
      `,
    },
    entryPoints: ["/Users/user/project/src/index.js"],
    outdir: "/Users/user/project/dist",
    bundleErrors: {},
    bundleWarnings: {},
    minifyWhitespace: false,
    run: {
      stdout: "used\nfile1 side effect\nfile2 side effect",
    },
  });

  itBundled("bundler/side-effects-glob/brace-expansion", {
    files: {
      "/Users/user/project/src/index.js": /* js */ `
        import { used } from "./lib/used.js";
        import { unused } from "./lib/unused.js";
        import { componentA } from "./lib/components/component-a.js";
        import { componentB } from "./lib/components/component-b.js";
        import { componentC } from "./lib/components/component-c.js";
        import { utilityA } from "./lib/utilities/utility-a.js";
        import { utilityB } from "./lib/utilities/utility-b.js";
        console.log(used);
      `,
      "/Users/user/project/src/lib/used.js": /* js */ `
        export const used = "used";
      `,
      "/Users/user/project/src/lib/unused.js": /* js */ `
        export const unused = "unused";
      `,
      "/Users/user/project/src/lib/components/component-a.js": /* js */ `
        console.log("component A side effect");
        export const componentA = "component-a";
      `,
      "/Users/user/project/src/lib/components/component-b.js": /* js */ `
        console.log("component B side effect");
        export const componentB = "component-b";
      `,
      "/Users/user/project/src/lib/components/component-c.js": /* js */ `
        export const componentC = "component-c";
      `,
      "/Users/user/project/src/lib/utilities/utility-a.js": /* js */ `
        console.log("utility A side effect");
        export const utilityA = "utility-a";
      `,
      "/Users/user/project/src/lib/utilities/utility-b.js": /* js */ `
        export const utilityB = "utility-b";
      `,
      "/Users/user/project/package.json": /* json */ `
        {
          "name": "test-glob-side-effects",
          "sideEffects": ["src/lib/{components,utilities}/*-a.js"]
        }
      `,
    },
    entryPoints: ["/Users/user/project/src/index.js"],
    outdir: "/Users/user/project/dist",
    bundleErrors: {},
    bundleWarnings: {},
    minifyWhitespace: false,
    run: {
      stdout: "used\ncomponent A side effect\nutility A side effect",
    },
  });
});