import { describe, expect } from "bun:test";
import { itBundled } from "./expectBundled";

// A stand-in for zod with the shape the option relies on: `zod/compile` is a
// side-effect module that installs a hook on a shared core module, and every
// schema constructor calls that hook. A schema therefore records whether
// `zod/compile` evaluated before the schema was constructed.
//
// The first file in `files` is the entry point, so spread this after it.
const zodPackage = {
  "/node_modules/zod/package.json": JSON.stringify({
    name: "zod",
    version: "4.5.0",
    exports: {
      ".": "./index.js",
      "./mini": "./mini.js",
      "./compile": "./compile.js",
    },
    sideEffects: ["./compile.js"],
  }),
  "/node_modules/zod/core.js": /* js */ `
    export const config = { postProcessor: null };
    export function make(kind) {
      const schema = { kind, compiled: false };
      config.postProcessor?.(schema);
      return schema;
    }
  `,
  "/node_modules/zod/index.js": /* js */ `
    import { make } from "./core.js";
    export const object = () => make("object");
  `,
  "/node_modules/zod/mini.js": /* js */ `
    import { make } from "./core.js";
    export const object = () => make("mini-object");
  `,
  "/node_modules/zod/compile.js": /* js */ `
    import { config } from "./core.js";
    config.postProcessor = schema => {
      schema.compiled = true;
    };
  `,
};

// The bundler prints the path of every bundled module as a comment, so this
// tells whether `zod/compile` made it into the bundle at all.
const compileModule = "node_modules/zod/compile.js";

describe("bundler", () => {
  for (const backend of ["cli", "api"] as const) {
    itBundled(`zod_compiler/${backend}/SchemaConstructedAfterCompileImport`, {
      backend,
      zodCompiler: true,
      files: {
        "/entry.js": /* js */ `
          import { object } from "zod";
          console.log(object().compiled);
        `,
        ...zodPackage,
      },
      onAfterBundle(api) {
        api.expectFile("/out.js").toContain(compileModule);
      },
      run: { stdout: "true" },
    });

    itBundled(`zod_compiler/${backend}/OffByDefault`, {
      backend,
      files: {
        "/entry.js": /* js */ `
          import { object } from "zod";
          console.log(object().compiled);
        `,
        ...zodPackage,
      },
      onAfterBundle(api) {
        api.expectFile("/out.js").not.toContain(compileModule);
      },
      run: { stdout: "false" },
    });
  }

  itBundled("zod_compiler/InjectedIntoTheModuleThatImportsZod", {
    zodCompiler: true,
    files: {
      // The entry point does not import zod itself. The schema is
      // constructed while `schemas.js` evaluates, so the import has to be in
      // front of that module.
      "/entry.js": /* js */ `
        import { schema } from "./schemas.js";
        console.log(schema.compiled);
      `,
      "/schemas.js": /* js */ `
        import { object } from "zod";
        export const schema = object();
      `,
      ...zodPackage,
    },
    run: { stdout: "true" },
  });

  itBundled("zod_compiler/Subpath", {
    zodCompiler: true,
    files: {
      "/entry.js": /* js */ `
        import { object } from "zod/mini";
        console.log(object().compiled);
      `,
      ...zodPackage,
    },
    run: { stdout: "true" },
  });

  itBundled("zod_compiler/Require", {
    zodCompiler: true,
    files: {
      "/entry.js": /* js */ `
        const { object } = require("zod");
        module.exports = object();
        console.log(module.exports.compiled);
      `,
      ...zodPackage,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain(compileModule);
    },
    run: { stdout: "true" },
  });

  itBundled("zod_compiler/NoZodImport", {
    zodCompiler: true,
    files: {
      // zod is not installed. Nothing imports it, so nothing may try to
      // resolve `zod/compile`.
      "/entry.js": /* js */ `
        console.log("no schemas here");
      `,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("zod");
    },
    run: { stdout: "no schemas here" },
  });

  itBundled("zod_compiler/TypeOnlyImport", {
    zodCompiler: true,
    files: {
      "/entry.ts": /* ts */ `
        import { object } from "zod";
        type Schema = ReturnType<typeof object>;
        const schema: Schema | null = null;
        console.log(schema);
      `,
      ...zodPackage,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain(compileModule);
    },
    run: { stdout: "null" },
  });

  itBundled("zod_compiler/DynamicImportStaysLazy", {
    zodCompiler: true,
    files: {
      "/entry.js": /* js */ `
        const { object } = await import("zod");
        console.log(object().compiled);
      `,
      ...zodPackage,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain(compileModule);
    },
    run: { stdout: "false" },
  });

  // A dependency that constructs a schema while it loads.
  const usesZodPackage = {
    "/node_modules/uses-zod/package.json": JSON.stringify({ name: "uses-zod", main: "index.js" }),
    "/node_modules/uses-zod/index.js": /* js */ `
      import { object } from "zod";
      export const schema = object();
    `,
  };

  itBundled("zod_compiler/NodeModulesGetNoImportOfTheirOwn", {
    zodCompiler: true,
    files: {
      "/entry.js": /* js */ `
        import { schema } from "uses-zod";
        console.log(schema.compiled);
      `,
      ...usesZodPackage,
      ...zodPackage,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain(compileModule);
    },
    run: { stdout: "false" },
  });

  itBundled("zod_compiler/ImportGoesAheadOfTheModulesOwnImports", {
    zodCompiler: true,
    files: {
      // `uses-zod` is imported before zod is. The generated import still has
      // to evaluate before it, so the schema it constructs is compiled too.
      "/entry.js": /* js */ `
        import { schema } from "uses-zod";
        import { object } from "zod";
        console.log(schema.compiled, object().compiled);
      `,
      ...usesZodPackage,
      ...zodPackage,
    },
    run: { stdout: "true true" },
  });

  itBundled("zod_compiler/ExternalPackagesKeepTheImportFirst", {
    zodCompiler: true,
    target: "bun",
    packages: "external",
    files: {
      "/entry.js": /* js */ `
        import { object } from "zod";
        console.log(object().compiled);
      `,
      ...zodPackage,
    },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      const compileImport = out.indexOf('"zod/compile"');
      expect(compileImport).not.toBe(-1);
      expect(compileImport).toBeLessThan(out.indexOf('from "zod"'));
    },
    run: { stdout: "true" },
  });

  itBundled("zod_compiler/ExplicitCompileImportIsNotDuplicated", {
    zodCompiler: true,
    target: "bun",
    packages: "external",
    files: {
      "/entry.js": /* js */ `
        import { object } from "zod";
        import "zod/compile";
        console.log(object().compiled);
      `,
      ...zodPackage,
    },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out.split('"zod/compile"')).toHaveLength(2);
    },
    run: { stdout: "true" },
  });

  const filesWithOldZod = {
    "/entry.js": /* js */ `
      import { object } from "zod";
      console.log(object().compiled);
    `,
    ...zodPackage,
    "/node_modules/zod/package.json": JSON.stringify({
      name: "zod",
      version: "3.25.0",
      exports: { ".": "./index.js" },
    }),
  };
  const unresolvedCompileEntry = {
    "/entry.js": [
      'Could not resolve: "zod/compile". The zod compiler option adds this import to every module that imports zod. It needs a version of zod that exports "zod/compile".',
    ],
  };

  itBundled("zod_compiler/ZodWithoutCompileEntryFailsTheBuild", {
    zodCompiler: true,
    files: filesWithOldZod,
    bundleErrors: unresolvedCompileEntry,
  });

  // A resolve plugin that declines hands the import to a second copy of the
  // resolution error path.
  itBundled("zod_compiler/ZodWithoutCompileEntryFailsTheBuildWithResolvePlugin", {
    zodCompiler: true,
    files: filesWithOldZod,
    plugins(builder) {
      builder.onResolve({ filter: /.*/ }, () => undefined);
    },
    bundleErrors: unresolvedCompileEntry,
  });
});
