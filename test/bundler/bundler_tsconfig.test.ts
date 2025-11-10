import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  itBundled("tsconfig/TsconfigParameterWithBaseUrl", {
    files: {
      "/src/entry.ts": /* ts */ `
        import helper from "utils/helper";
        helper();
      `,
      "/src/utils/helper.ts": /* ts */ `
        export default function helper() {
          console.log("helper called");
        }
      `,
      "/tsconfig.custom.json": JSON.stringify({
        compilerOptions: {
          baseUrl: "./src",
        },
      }),
    },
    tsconfig: "/tsconfig.custom.json",
    run: {
      stdout: "helper called",
    },
  });

  itBundled("tsconfig/TsconfigParameterOverridesDefault", {
    files: {
      "/src/entry.ts": /* ts */ `
        import helper from "lib/helper";
        helper();
      `,
      "/src/lib/helper.ts": /* ts */ `
        export default function helper() {
          console.log("custom tsconfig used");
        }
      `,
      "/tsconfig.json": JSON.stringify({
        compilerOptions: {
          baseUrl: "./wrong",
        },
      }),
      "/tsconfig.custom.json": JSON.stringify({
        compilerOptions: {
          baseUrl: "./src",
        },
      }),
    },
    tsconfig: "/tsconfig.custom.json",
    run: {
      stdout: "custom tsconfig used",
    },
  });

  itBundled("tsconfig/TsconfigParameterWithExtends", {
    files: {
      "/src/entry.ts": /* ts */ `
        import helper from "utils/helper";
        helper();
      `,
      "/src/utils/helper.ts": /* ts */ `
        export default function helper() {
          console.log("extends works");
        }
      `,
      "/tsconfig.base.json": JSON.stringify({
        compilerOptions: {
          baseUrl: "./src",
        },
      }),
      "/tsconfig.custom.json": JSON.stringify({
        extends: "./tsconfig.base.json",
        compilerOptions: {
          strict: true,
        },
      }),
    },
    tsconfig: "/tsconfig.custom.json",
    run: {
      stdout: "extends works",
    },
  });
});
