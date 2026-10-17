import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { itBundled } from "./expectBundled";

describe("bundler feature flags", () => {
  // Test both CLI and API backends
  for (const backend of ["cli", "api"] as const) {
    describe(`backend: ${backend}`, () => {
      itBundled(`feature_flag/${backend}/FeatureReturnsTrue`, {
        backend,
        files: {
          "/a.js": `
import { feature } from "bun:bundle";
if (feature("SUPER_SECRET")) {
  console.log("feature enabled");
} else {
  console.log("feature disabled");
}
`,
        },
        features: ["SUPER_SECRET"],
        onAfterBundle(api) {
          // The output should contain `true` since the feature is enabled
          api.expectFile("out.js").toInclude("true");
          api.expectFile("out.js").not.toInclude("feature(");
          api.expectFile("out.js").not.toInclude("bun:bundle");
        },
      });

      itBundled(`feature_flag/${backend}/FeatureReturnsFalse`, {
        backend,
        files: {
          "/a.js": `
import { feature } from "bun:bundle";
if (feature("SUPER_SECRET")) {
  console.log("feature enabled");
} else {
  console.log("feature disabled");
}
`,
        },
        // No features enabled
        onAfterBundle(api) {
          // The output should contain `false` since the feature is not enabled
          api.expectFile("out.js").toInclude("false");
          api.expectFile("out.js").not.toInclude("feature(");
          api.expectFile("out.js").not.toInclude("bun:bundle");
        },
      });

      itBundled(`feature_flag/${backend}/MultipleFlags`, {
        backend,
        files: {
          "/a.js": `
import { feature } from "bun:bundle";
if (feature("FLAG_A")) console.log("FLAG_A");
if (feature("FLAG_B")) console.log("FLAG_B");
if (feature("FLAG_C")) console.log("FLAG_C");
`,
        },
        features: ["FLAG_A", "FLAG_C"],
        onAfterBundle(api) {
          // FLAG_A and FLAG_C are enabled, FLAG_B is not
          api.expectFile("out.js").toInclude("true");
          api.expectFile("out.js").toInclude("false");
        },
      });

      itBundled(`feature_flag/${backend}/DeadCodeElimination`, {
        backend,
        files: {
          "/a.js": `
import { feature } from "bun:bundle";
if (feature("ENABLED_FEATURE")) {
  console.log("this should be kept");
}
if (feature("DISABLED_FEATURE")) {
  console.log("this should be removed");
}
`,
        },
        features: ["ENABLED_FEATURE"],
        minifySyntax: true,
        onAfterBundle(api) {
          // With minification, dead code should be eliminated
          api.expectFile("out.js").toInclude("this should be kept");
          api.expectFile("out.js").not.toInclude("this should be removed");
        },
      });

      itBundled(`feature_flag/${backend}/ImportRemoved`, {
        backend,
        files: {
          "/a.js": `
import { feature } from "bun:bundle";
if (feature("TEST")) {
  console.log("test enabled");
}
`,
        },
        onAfterBundle(api) {
          // The import should be completely removed
          api.expectFile("out.js").not.toInclude("bun:bundle");
        },
      });

      itBundled(`feature_flag/${backend}/IfBlockRemoved`, {
        backend,
        files: {
          "/a.js": `
import { feature } from "bun:bundle";
function expensiveComputation() {
  return "expensive result";
}
if (feature("DISABLED")) {
  const result = expensiveComputation();
  console.log("This entire block should be removed:", result);
}
console.log("This should remain");
`,
        },
        minifySyntax: true,
        onAfterBundle(api) {
          // The expensive computation and related code should be completely eliminated
          api.expectFile("out.js").not.toInclude("expensiveComputation");
          api.expectFile("out.js").not.toInclude("expensive result");
          api.expectFile("out.js").not.toInclude("This entire block should be removed");
          api.expectFile("out.js").toInclude("This should remain");
        },
      });

      itBundled(`feature_flag/${backend}/KeepsElseBranch`, {
        backend,
        files: {
          "/a.js": `
import { feature } from "bun:bundle";
if (feature("DISABLED")) {
  console.log("if branch - should be removed");
} else {
  console.log("else branch - should be kept");
}
`,
        },
        minifySyntax: true,
        onAfterBundle(api) {
          api.expectFile("out.js").not.toInclude("if branch - should be removed");
          api.expectFile("out.js").toInclude("else branch - should be kept");
        },
      });

      itBundled(`feature_flag/${backend}/RemovesElseBranch`, {
        backend,
        files: {
          "/a.js": `
import { feature } from "bun:bundle";
if (feature("ENABLED")) {
  console.log("if branch - should be kept");
} else {
  console.log("else branch - should be removed");
}
`,
        },
        features: ["ENABLED"],
        minifySyntax: true,
        onAfterBundle(api) {
          api.expectFile("out.js").toInclude("if branch - should be kept");
          api.expectFile("out.js").not.toInclude("else branch - should be removed");
        },
      });

      itBundled(`feature_flag/${backend}/AliasedImport`, {
        backend,
        files: {
          "/a.js": `
import { feature as checkFeature } from "bun:bundle";
if (checkFeature("ALIASED")) {
  console.log("aliased feature enabled");
} else {
  console.log("aliased feature disabled");
}
`,
        },
        features: ["ALIASED"],
        onAfterBundle(api) {
          api.expectFile("out.js").toInclude("true");
          api.expectFile("out.js").not.toInclude("checkFeature");
        },
      });

      itBundled(`feature_flag/${backend}/TernaryDisabled`, {
        backend,
        files: {
          "/a.js": `
import { feature } from "bun:bundle";
const result = feature("TERNARY_FLAG") ? "ternary_enabled" : "ternary_disabled";
console.log(result);
`,
        },
        minifySyntax: true,
        onAfterBundle(api) {
          api.expectFile("out.js").toInclude("ternary_disabled");
          api.expectFile("out.js").not.toInclude("ternary_enabled");
        },
      });

      itBundled(`feature_flag/${backend}/TernaryEnabled`, {
        backend,
        files: {
          "/a.js": `
import { feature } from "bun:bundle";
const result = feature("TERNARY_FLAG") ? "ternary_enabled" : "ternary_disabled";
console.log(result);
`,
        },
        features: ["TERNARY_FLAG"],
        minifySyntax: true,
        onAfterBundle(api) {
          api.expectFile("out.js").toInclude("ternary_enabled");
          api.expectFile("out.js").not.toInclude("ternary_disabled");
        },
      });
    });
  }

  // Error cases - only test with CLI since error handling might differ
  itBundled("feature_flag/NonStringArgError", {
    backend: "cli",
    files: {
      "/a.js": `
import { feature } from "bun:bundle";
const flag = "DYNAMIC";
if (feature(flag)) {
  console.log("dynamic");
}
`,
    },
    bundleErrors: {
      "/a.js": ["feature() argument must be a string literal"],
    },
  });

  itBundled("feature_flag/NoArgsError", {
    backend: "cli",
    files: {
      "/a.js": `
import { feature } from "bun:bundle";
if (feature()) {
  console.log("no args");
}
`,
    },
    bundleErrors: {
      "/a.js": ["feature() requires exactly one string argument"],
    },
  });

  // Error cases for invalid usage of feature() - must be in if/ternary condition
  itBundled("feature_flag/ConstAssignmentError", {
    backend: "cli",
    files: {
      "/a.js": `
import { feature } from "bun:bundle";
const x = feature("FLAG");
console.log(x);
`,
    },
    bundleErrors: {
      "/a.js": ['feature() from "bun:bundle" can only be used directly in an if statement or ternary condition'],
    },
  });

  itBundled("feature_flag/LetAssignmentError", {
    backend: "cli",
    files: {
      "/a.js": `
import { feature } from "bun:bundle";
let x = feature("FLAG");
console.log(x);
`,
    },
    bundleErrors: {
      "/a.js": ['feature() from "bun:bundle" can only be used directly in an if statement or ternary condition'],
    },
  });

  itBundled("feature_flag/ExportDefaultError", {
    backend: "cli",
    files: {
      "/a.js": `
import { feature } from "bun:bundle";
export default feature("FLAG");
`,
    },
    bundleErrors: {
      "/a.js": ['feature() from "bun:bundle" can only be used directly in an if statement or ternary condition'],
    },
  });

  itBundled("feature_flag/FunctionArgumentError", {
    backend: "cli",
    files: {
      "/a.js": `
import { feature } from "bun:bundle";
console.log(feature("FLAG"));
`,
    },
    bundleErrors: {
      "/a.js": ['feature() from "bun:bundle" can only be used directly in an if statement or ternary condition'],
    },
  });

  itBundled("feature_flag/ReturnStatementError", {
    backend: "cli",
    files: {
      "/a.js": `
import { feature } from "bun:bundle";
function foo() {
  return feature("FLAG");
}
`,
    },
    bundleErrors: {
      "/a.js": ['feature() from "bun:bundle" can only be used directly in an if statement or ternary condition'],
    },
  });

  itBundled("feature_flag/ArrayLiteralError", {
    backend: "cli",
    files: {
      "/a.js": `
import { feature } from "bun:bundle";
const arr = [feature("FLAG")];
`,
    },
    bundleErrors: {
      "/a.js": ['feature() from "bun:bundle" can only be used directly in an if statement or ternary condition'],
    },
  });

  itBundled("feature_flag/ObjectPropertyError", {
    backend: "cli",
    files: {
      "/a.js": `
import { feature } from "bun:bundle";
const obj = { flag: feature("FLAG") };
`,
    },
    bundleErrors: {
      "/a.js": ['feature() from "bun:bundle" can only be used directly in an if statement or ternary condition'],
    },
  });

  // Valid usage patterns - these should work without errors
  for (const backend of ["cli", "api"] as const) {
    itBundled(`feature_flag/${backend}/ValidIfStatement`, {
      backend,
      files: {
        "/a.js": `
import { feature } from "bun:bundle";
if (feature("FLAG")) {
  console.log("enabled");
}
`,
      },
      features: ["FLAG"],
      onAfterBundle(api) {
        api.expectFile("out.js").toInclude("true");
        api.expectFile("out.js").not.toInclude("feature(");
      },
    });

    itBundled(`feature_flag/${backend}/ValidTernary`, {
      backend,
      files: {
        "/a.js": `
import { feature } from "bun:bundle";
const x = feature("FLAG") ? "yes" : "no";
console.log(x);
`,
      },
      features: ["FLAG"],
      minifySyntax: true,
      onAfterBundle(api) {
        api.expectFile("out.js").toInclude("yes");
        api.expectFile("out.js").not.toInclude("no");
      },
    });

    itBundled(`feature_flag/${backend}/ValidElseIf`, {
      backend,
      files: {
        "/a.js": `
import { feature } from "bun:bundle";
if (feature("A")) {
  console.log("A");
} else if (feature("B")) {
  console.log("B");
} else {
  console.log("neither");
}
`,
      },
      features: ["B"],
      minifySyntax: true,
      onAfterBundle(api) {
        api.expectFile("out.js").toInclude("B");
        api.expectFile("out.js").not.toInclude("neither");
      },
    });

    itBundled(`feature_flag/${backend}/ValidNestedTernary`, {
      backend,
      files: {
        "/a.js": `
import { feature } from "bun:bundle";
const x = feature("A") ? "A" : feature("B") ? "B" : "C";
console.log(x);
`,
      },
      features: ["B"],
      minifySyntax: true,
      onAfterBundle(api) {
        api.expectFile("out.js").toInclude("B");
        api.expectFile("out.js").not.toInclude("A");
      },
    });
  }

  // "bun:bundle" does not exist at runtime and its import statement is removed.
  // A binding that is not a direct `feature("FLAG")` call would have no
  // declaration, so each of these must fail the build.
  const NAMESPACE = `"bun:bundle" cannot be imported as a namespace`;
  const DEFAULT = `"bun:bundle" has no export named "default"`;
  const MACRO = `"bun:bundle" cannot be imported as a macro`;
  const REEXPORT = `"bun:bundle" does not exist at runtime and cannot be re-exported`;
  // The error is at the statement with the use. It is at the import when the
  // file is one part with more than one statement.
  const usedAsValue = (name: string, where = " in this statement") =>
    `"${name}" from "bun:bundle" is used as a value${where}, but it can only be called directly, as in ${name}("FLAG")`;

  const refusedAtImport: Record<string, [source: string, ...errors: string[]]> = {
    "/namespace.js": [`import * as flags from "bun:bundle"; if (flags.feature("FLAG")) console.log("on");`, NAMESPACE],
    "/default.js": [`import flags from "bun:bundle"; if (flags.feature("FLAG")) console.log("on");`, DEFAULT],
    "/default-and-named.js": [
      `import flags, { feature } from "bun:bundle"; if (feature("FLAG")) console.log(typeof flags);`,
      DEFAULT,
    ],
    "/default-and-namespace.js": [`import d, * as ns from "bun:bundle"; console.log(d, ns);`, DEFAULT, NAMESPACE],
    "/defer-namespace.js": [`import defer * as ns from "bun:bundle"; console.log(ns);`, NAMESPACE],
    "/namespace-beside-named.js": [
      `import { feature } from "bun:bundle"; import * as ns from "bun:bundle"; if (feature("FLAG")) console.log(ns);`,
      NAMESPACE,
    ],
    "/unused-namespace.js": [`import * as flags from "bun:bundle"; console.log("unused");`, NAMESPACE],
    "/unused-default.js": [`import flags from "bun:bundle"; console.log("unused");`, DEFAULT],
    "/type-only-namespace-use.ts": [
      `import * as B from "bun:bundle"; const r: B.Registry = {}; console.log(r);`,
      NAMESPACE,
    ],
    "/macro-attribute.js": [
      `import { feature } from "bun:bundle" with { type: "macro" }; if (feature("FLAG")) console.log("on");`,
      MACRO,
    ],
    "/default-with-macro-attribute.js": [
      `import flags from "bun:bundle" with { type: "macro" }; const f = flags; console.log(f);`,
      MACRO,
    ],
    "/reexport-named.js": [`export { feature } from "bun:bundle";`, REEXPORT],
    "/reexport-star.js": [`export * from "bun:bundle";`, REEXPORT],
    "/reexport-namespace.js": [`export * as flags from "bun:bundle";`, REEXPORT],
  };

  const refusedAfterVisit: Record<string, [source: string, ...errors: string[]]> = {
    "/renamed.js": [`import { feature as enabled } from "bun:bundle"; console.log(enabled);`, usedAsValue("enabled")],
  };
  for (const [file, use] of Object.entries({
    "/alias.js": `const f = feature; if (f("FLAG")) console.log("on");`,
    // Refused in every mode, also where the minifier could inline `f`.
    "/function-alias.js": `function g() { const f = feature; return f("FLAG") ? "on" : "off"; } console.log(g());`,
    "/argument.js": `console.log(["FLAG"].map(feature));`,
    "/comma-call.js": `if ((0, feature)("FLAG")) console.log("on");`,
    "/method-call.js": `if (feature.call(null, "FLAG")) console.log("on");`,
    "/new.js": `if (new feature("FLAG")) console.log("on");`,
    "/tagged-template.js": "if (feature`FLAG`) console.log('on');",
    "/export-default.js": `export default feature;`,
    "/export-clause.js": `export { feature };`,
    "/typeof.js": `console.log(typeof feature);`,
    "/typeof-guard.js": `console.log(typeof feature === "function" && feature("FLAG") ? "on" : "off");`,
    "/assignment.js": `feature = 1;`,
    "/after-return.js": `export function f() { return 1; console.log(feature); }`,
    // Refused while parsing, before tree shaking could remove the function.
    "/unused-function.js": `function unused() { return feature; }`,
    "/import-equals.ts": `import f = feature;`,
    // A replaced call, live or dead, must not hide a use in another statement.
    "/use-before-call.js": `console.log(feature); feature("FLAG") ? 1 : 2;`,
    "/use-after-call.js": `feature("FLAG") ? 1 : 2; console.log(feature);`,
    "/use-before-dead-call.js": `console.log(typeof feature); if (feature("OFF")) { if (feature("FLAG")) console.log("on"); }`,
    "/use-after-dead-call.js": `if (false) { if (feature("FLAG")) console.log("on"); } console.log(typeof feature);`,
  })) {
    refusedAfterVisit[file] = [`import { feature } from "bun:bundle"; ${use}`, usedAsValue("feature")];
  }

  // Each of these builds today and must keep building. Each module prints one line.
  const accepted: Record<string, [source: string, stdout: string]> = {
    "/renamed.js": [
      `import { feature as enabled } from "bun:bundle"; console.log("renamed", enabled("FLAG") ? "on" : "off");`,
      "renamed on",
    ],
    "/string-name.js": [
      `import { "feature" as enabled } from "bun:bundle"; console.log("string-name", enabled("FLAG") ? "on" : "off");`,
      "string-name on",
    ],
    "/bare.js": [`import "bun:bundle"; console.log("bare");`, "bare"],
    "/empty-clause.js": [`import {} from "bun:bundle"; console.log("empty-clause");`, "empty-clause"],
    "/type-namespace.ts": [
      `import type * as B from "bun:bundle"; const r: B.Registry = {}; console.log("type-namespace", typeof r);`,
      "type-namespace object",
    ],
    "/type-default.ts": [`import type B from "bun:bundle"; console.log("type-default");`, "type-default"],
    "/type-specifier.ts": [
      `import { feature, type Registry } from "bun:bundle"; const r: Registry = {}; console.log("type-specifier", feature("FLAG") ? "on" : "off", typeof r);`,
      "type-specifier on object",
    ],
    "/type-reexport.ts": [
      `export type { Registry } from "bun:bundle"; export type * from "bun:bundle"; console.log("type-reexport");`,
      "type-reexport",
    ],
    "/typeof-type.ts": [
      `import { feature } from "bun:bundle"; type F = typeof feature; const f: F | null = null; console.log("typeof-type", feature("FLAG") ? "on" : "off", f);`,
      "typeof-type on null",
    ],
    "/type-assertions.ts": [
      `import { feature } from "bun:bundle"; console.log("type-assertions", (feature as any)("FLAG") ? "on" : "off", feature!("FLAG") ? "on" : "off", (<any>feature)("FLAG") ? "on" : "off", (feature satisfies unknown)("FLAG") ? "on" : "off", feature<string>("FLAG") ? "on" : "off");`,
      "type-assertions on on on on on",
    ],
    "/optional-call.js": [
      `import { feature } from "bun:bundle"; console.log("optional-call", feature?.("FLAG") ? "on" : "off");`,
      "optional-call on",
    ],
    "/parenthesized-call.js": [
      `import { feature } from "bun:bundle"; console.log("parenthesized-call", (feature)("FLAG") ? "on" : "off");`,
      "parenthesized-call on",
    ],
    "/use-before-import.js": [
      `console.log("use-before-import", feature("FLAG") ? "on" : "off"); import { feature } from "bun:bundle";`,
      "use-before-import on",
    ],
    "/shadowed.js": [
      `import { feature } from "bun:bundle"; const len = feature => feature.length; console.log("shadowed", feature("FLAG") ? "on" : "off", len("abc"));`,
      "shadowed on 3",
    ],
    // A use in a branch that is dead under the passed flags is not an error.
    "/dead-branch.js": [
      `import { feature } from "bun:bundle"; if (false) console.log(typeof feature); if (feature("OFF")) console.log(feature); console.log("dead-branch", feature("FLAG") ? "on" : "off");`,
      "dead-branch on",
    ],
    "/dead-call.js": [
      `import { feature } from "bun:bundle"; if (feature("OFF")) { if (feature("FLAG")) console.log("never"); } false && (feature("FLAG") ? 1 : 2); console.log("dead-call", feature("FLAG") ? "on" : "off");`,
      "dead-call on",
    ],
  };

  const refused = { ...refusedAtImport, ...refusedAfterVisit };
  const sourcesOf = (rows: Record<string, readonly [source: string, ...rest: string[]]>) =>
    Object.fromEntries(Object.entries(rows).map(([file, [source]]) => [file, source]));
  const acceptedBundle = {
    files: {
      "/entry.js": Object.keys(accepted)
        .map(file => `import ".${file}";`)
        .join("\n"),
      ...sourcesOf(accepted),
    },
    features: ["FLAG"],
    run: {
      stdout: Object.values(accepted)
        .map(([, stdout]) => stdout)
        .join("\n"),
    },
  };

  for (const backend of ["cli", "api"] as const) {
    itBundled(`feature_flag/${backend}/RefusesBindingsLeftInOutput`, {
      backend,
      files: sourcesOf(refused),
      entryPoints: Object.keys(refused),
      features: ["FLAG"],
      bundleErrors: Object.fromEntries(Object.entries(refused).map(([file, [, ...errors]]) => [file, errors])),
    });

    itBundled(`feature_flag/${backend}/AcceptsEveryValidForm`, { backend, ...acceptedBundle });
  }
  itBundled("feature_flag/AcceptsEveryValidFormMinified", {
    backend: "api",
    ...acceptedBundle,
    minifySyntax: true,
    minifyIdentifiers: true,
  });
  itBundled("feature_flag/AcceptsEveryValidFormWithoutTreeShaking", {
    backend: "api",
    ...acceptedBundle,
    treeShaking: false,
  });

  // `(0, feature)("FLAG")` is a direct call once the minifier drops the `0`.
  // An alias is not: it is refused also where the minifier could inline it.
  itBundled("feature_flag/MinifySyntaxFoldsOnlyTheCommaCall", {
    backend: "api",
    files: {
      "/comma-call.js": `import { feature } from "bun:bundle"; console.log((0, feature)("FLAG") ? "on" : "off");`,
      "/function-alias.js": refusedAfterVisit["/function-alias.js"][0],
    },
    entryPoints: ["/comma-call.js", "/function-alias.js"],
    features: ["FLAG"],
    minifySyntax: true,
    bundleErrors: { "/function-alias.js": [usedAsValue("feature")] },
  });

  test("the error is at the statement with the use, and the note is at the import", async () => {
    using dir = tempDir("bundler-feature-flag", {
      "far.js": [
        `import { feature as enabled } from "bun:bundle";`,
        `if (enabled("FLAG")) console.log("on");`,
        `export function later() {`,
        `  return [1, 2].map(enabled);`,
        `}`,
        `  const alias = enabled;`,
      ].join("\n"),
    });
    const build = await Bun.build({ entrypoints: [`${dir}/far.js`], features: ["FLAG"], throw: false });
    expect(
      build.logs.map(log => ({
        message: log.message,
        at: [log.position?.line, log.position?.column],
        note: [log.notes[0].position?.line, log.notes[0].position?.column],
      })),
    ).toEqual([
      { message: usedAsValue("enabled"), at: [3, 8], note: [1, 10] },
      { message: usedAsValue("enabled"), at: [6, 3], note: [1, 10] },
    ]);
    expect(build.success).toBe(false);
  });

  async function spawnBun(cwd: string, ...args: string[]) {
    await using proc = Bun.spawn({ cmd: [bunExe(), ...args], cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.concurrent.each([
    [
      "a namespace import",
      `console.log("ran"); import * as flags from "bun:bundle"; flags.feature("FLAG");`,
      NAMESPACE,
    ],
    ["a default import", `console.log("ran"); import flags from "bun:bundle"; flags.feature("FLAG");`, DEFAULT],
    ["a re-export", `console.log("ran"); export { feature } from "bun:bundle";`, REEXPORT],
    [
      "a use that is not a call",
      `console.log("ran"); import { feature } from "bun:bundle"; const f = feature;`,
      usedAsValue("feature"),
    ],
    [
      "an alias in a function",
      `console.log("ran"); import { feature } from "bun:bundle"; function g() { const f = feature; return f("FLAG") ? "on" : "off"; } console.log(g());`,
      usedAsValue("feature"),
    ],
  ])("bun run and bun test refuse %s", async (_, source, error) => {
    using dir = tempDir("bundler-feature-flag", { "index.ts": source, "index.test.ts": source });
    const [run, test] = await Promise.all([
      spawnBun(String(dir), "run", "./index.ts"),
      spawnBun(String(dir), "test", "./index.test.ts"),
    ]);

    // The file does not load, so "ran" is never printed.
    expect(run.stderr).toContain(error);
    expect(run.stdout).toBe("");
    expect(run.exitCode).toBe(1);
    expect(test.stderr).toContain(error);
    expect(test.stdout).not.toContain("ran");
    expect(test.exitCode).toBe(1);
  });

  // What Bun.Transpiler throws, with the place of a use taken out of the message.
  const errorsOf = (fn: () => unknown): string[] => {
    try {
      fn();
    } catch (e: any) {
      return (e instanceof AggregateError ? e.errors : [e]).map(error =>
        error.message.replace(" in this statement", ""),
      );
    }
    return [];
  };
  const anywhere = (errors: string[]) => errors.map(error => error.replace(" in this statement", ""));

  test("Bun.Transpiler refuses them too", () => {
    const plain = new Bun.Transpiler({ loader: "ts" });
    const minifySyntax = new Bun.Transpiler({ loader: "ts", minify: { syntax: true } });
    const keepsDeadCode = new Bun.Transpiler({ loader: "ts", deadCodeElimination: false });

    for (const [file, [source, ...errors]] of Object.entries(refusedAtImport)) {
      // scanImports() only parses. The statement is refused while parsing.
      expect({
        file,
        scanImports: errorsOf(() => plain.scanImports(source)),
        scan: errorsOf(() => plain.scan(source)),
        transformSync: errorsOf(() => plain.transformSync(source)),
        minifySyntax: errorsOf(() => minifySyntax.transformSync(source)),
        keepsDeadCode: errorsOf(() => keepsDeadCode.transformSync(source)),
      }).toEqual({
        file,
        scanImports: errors,
        scan: errors,
        transformSync: errors,
        minifySyntax: errors,
        keepsDeadCode: errors,
      });
    }
    for (const [file, [source, ...errors]] of Object.entries(refusedAfterVisit)) {
      expect({
        file,
        scan: errorsOf(() => plain.scan(source)),
        transformSync: errorsOf(() => plain.transformSync(source)),
        minifySyntax: errorsOf(() => minifySyntax.transformSync(source)),
        keepsDeadCode: errorsOf(() => keepsDeadCode.transformSync(source)),
      }).toEqual({
        file,
        scan: anywhere(errors),
        transformSync: anywhere(errors),
        // Only the comma call becomes a direct call when the syntax is minified.
        minifySyntax: file === "/comma-call.js" ? [] : anywhere(errors),
        keepsDeadCode: anywhere(errors),
      });
    }
    for (const [file, [source]] of Object.entries(accepted)) {
      expect({
        file,
        transformSync: errorsOf(() => plain.transformSync(source)),
        minifySyntax: errorsOf(() => minifySyntax.transformSync(source)),
        keepsDeadCode: errorsOf(() => keepsDeadCode.transformSync(source)),
      }).toEqual({
        file,
        transformSync: [],
        minifySyntax: [],
        // A use in a dead branch is an error where the branch is kept.
        keepsDeadCode: file === "/dead-branch.js" ? [usedAsValue("feature", "")] : [],
      });
    }
  });

  // With `emitDecoratorMetadata`, a type that has the name of the binding
  // resolves to the binding. That is not a use of its value.
  test("a type named like the binding is not a use of it", () => {
    const transpiler = new Bun.Transpiler({
      loader: "ts",
      tsconfig: { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } },
    });
    const prelude = `import { feature } from "bun:bundle"; function dec(...a: any[]): any {}`;
    const call = `console.log(feature("FLAG") ? "on" : "off");`;
    const types = {
      "namespace member": `namespace Flags { export type feature = string } class K { @dec p: Flags.feature = "x"; }`,
      "type parameter": `class K<feature> { @dec p: feature | undefined; }`,
      "interface": `interface feature { id: number } class K { @dec p: feature | undefined; @dec q: feature[] = []; }`,
      "namespace": `declare namespace feature { interface X { id: number } } class K { @dec p: feature.X | undefined; }`,
    };
    const refersToBinding = (output: string) => /(?<![\w$.])feature(?![\w$])/.test(output);
    for (const [name, source] of Object.entries(types)) {
      expect({
        name,
        importFirst: refersToBinding(transpiler.transformSync(`${prelude} ${source} ${call}`)),
        // The import statement can come after the class.
        importLast: refersToBinding(
          transpiler.transformSync(
            `function dec(...a: any[]): any {} ${source} ${call} import { feature } from "bun:bundle";`,
          ),
        ),
        besideValueUse: errorsOf(() => transpiler.transformSync(`${prelude} ${source} const f = feature; ${call}`)),
      }).toEqual({ name, importFirst: false, importLast: false, besideValueUse: [usedAsValue("feature", "")] });
    }
  });

  // A statement with no effect is removed. Its use of the binding goes with it
  // only when the statement is a part of its own, which `bun build` makes it.
  test("a removed statement is refused only when the file is one part", async () => {
    const source = `import { feature as enabled } from "bun:bundle"; void enabled; console.log("kept");`;
    using dir = tempDir("bundler-feature-flag", { "removed.js": source });
    const build = await Bun.build({ entrypoints: [`${dir}/removed.js`], throw: false });
    expect(build.logs).toEqual([]);
    expect(await build.outputs[0].text()).not.toContain("enabled");
    expect(() => new Bun.Transpiler({ loader: "js" }).transformSync(source)).toThrow(usedAsValue("enabled", ""));
  });

  // A reference in a dead branch is refused only where the branch is kept.
  // `bun test --coverage` and `bun --print` turn dead code elimination off.
  test("a reference in a dead branch is refused only when dead code is kept", async () => {
    const source = `import { feature } from "bun:bundle"; if (false) console.log(typeof feature);`;
    const error = usedAsValue("feature");

    expect(new Bun.Transpiler({ loader: "js" }).transformSync(source)).not.toContain("feature");
    expect(() => new Bun.Transpiler({ loader: "js", deadCodeElimination: false }).transformSync(source)).toThrow(
      usedAsValue("feature", ""),
    );

    using dir = tempDir("bundler-feature-flag", {
      "dead.test.ts": `${source} import { test } from "bun:test"; test("loads", () => {});`,
    });
    const [plain, coverage, print] = await Promise.all([
      spawnBun(String(dir), "test", "./dead.test.ts"),
      spawnBun(String(dir), "test", "--coverage", "./dead.test.ts"),
      spawnBun(String(dir), "--print", `${source} "printed"`),
    ]);
    expect(plain.stderr).not.toContain(error);
    expect(plain.exitCode).toBe(0);
    expect(coverage.stderr).toContain(error);
    expect(coverage.exitCode).toBe(1);
    expect(print.stderr).toContain(error);
    expect(print.stdout).toBe("");
    expect(print.exitCode).toBe(1);
  });

  // Runtime tests - these must remain as manual tests since they test bun run and bun test
  test("works correctly at runtime with bun run", async () => {
    using dir = tempDir("bundler-feature-flag", {
      "index.ts": `
import { feature } from "bun:bundle";

if (feature("RUNTIME_FLAG")) {
  console.log("runtime flag enabled");
} else {
  console.log("runtime flag disabled");
}
`,
    });

    // First, test without the flag
    await using proc1 = Bun.spawn({
      cmd: [bunExe(), "run", "./index.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout1, , exitCode1] = await Promise.all([
      new Response(proc1.stdout).text(),
      new Response(proc1.stderr).text(),
      proc1.exited,
    ]);

    expect(stdout1.trim()).toBe("runtime flag disabled");
    expect(exitCode1).toBe(0);

    // Now test with the flag enabled
    await using proc2 = Bun.spawn({
      cmd: [bunExe(), "run", "--feature=RUNTIME_FLAG", "./index.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout2, , exitCode2] = await Promise.all([
      new Response(proc2.stdout).text(),
      new Response(proc2.stderr).text(),
      proc2.exited,
    ]);

    expect(stdout2.trim()).toBe("runtime flag enabled");
    expect(exitCode2).toBe(0);
  });

  test("works correctly in bun test", async () => {
    using dir = tempDir("bundler-feature-flag", {
      "test.test.ts": `
import { test, expect } from "bun:test";
import { feature } from "bun:bundle";

test("feature flag in test", () => {
  if (feature("TEST_FLAG")) {
    console.log("TEST_FLAG_ENABLED");
  } else {
    console.log("TEST_FLAG_DISABLED");
  }
  expect(true).toBe(true);
});
`,
    });

    // First, test without the flag
    await using proc1 = Bun.spawn({
      cmd: [bunExe(), "test", "./test.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout1, , exitCode1] = await Promise.all([
      new Response(proc1.stdout).text(),
      new Response(proc1.stderr).text(),
      proc1.exited,
    ]);

    expect(stdout1).toContain("TEST_FLAG_DISABLED");
    expect(stdout1).not.toContain("TEST_FLAG_ENABLED");
    expect(exitCode1).toBe(0);

    // Now test with the flag enabled
    await using proc2 = Bun.spawn({
      cmd: [bunExe(), "test", "--feature=TEST_FLAG", "./test.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout2, , exitCode2] = await Promise.all([
      new Response(proc2.stdout).text(),
      new Response(proc2.stderr).text(),
      proc2.exited,
    ]);

    expect(stdout2).toContain("TEST_FLAG_ENABLED");
    expect(stdout2).not.toContain("TEST_FLAG_DISABLED");
    expect(exitCode2).toBe(0);
  });
});
