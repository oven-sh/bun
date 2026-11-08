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
  // A default or namespace binding would have no declaration, so the statement is an error.
  const NAMESPACE = `"bun:bundle" cannot be imported as a namespace`;
  const DEFAULT = `"bun:bundle" has no export named "default"`;

  const refused: Record<string, [source: string, ...errors: string[]]> = {
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
    // Refused whether or not the binding is used, as a wrong named specifier is.
    "/unused-namespace.js": [`import * as flags from "bun:bundle"; console.log("unused");`, NAMESPACE],
    "/unused-default.js": [`import flags from "bun:bundle"; console.log("unused");`, DEFAULT],
    "/type-only-namespace-use.ts": [
      `import * as B from "bun:bundle"; const r: B.Registry = {}; console.log(r);`,
      NAMESPACE,
    ],
    "/ambient.ts": [
      `declare module "pkg" { import * as B from "bun:bundle"; export const r: B.Registry; } console.log("ambient");`,
      NAMESPACE,
    ],
  };

  // Each of these builds today and must keep building. Each module prints one line.
  const accepted: Record<string, [source: string, stdout: string]> = {
    "/renamed.js": [
      `import { feature as enabled } from "bun:bundle"; console.log("renamed", enabled("FLAG") ? "on" : "off");`,
      "renamed on",
    ],
    "/bare.js": [`import "bun:bundle"; console.log("bare");`, "bare"],
    "/empty-clause.js": [`import {} from "bun:bundle"; console.log("empty-clause");`, "empty-clause"],
    "/type-namespace.ts": [
      `import type * as B from "bun:bundle"; const r: B.Registry = {}; console.log("type-namespace", typeof r);`,
      "type-namespace object",
    ],
    "/type-default.ts": [`import type B from "bun:bundle"; console.log("type-default");`, "type-default"],
    "/type-specifier.ts": [
      `import { type feature } from "bun:bundle"; console.log("type-specifier");`,
      "type-specifier",
    ],
    "/use-before-import.js": [
      `console.log("use-before-import", feature("FLAG") ? "on" : "off"); import { feature } from "bun:bundle";`,
      "use-before-import on",
    ],
    // Outside a call the name stays a free variable.
    "/typeof-feature.js": [
      `import { feature } from "bun:bundle"; console.log("typeof-feature", typeof feature, feature("FLAG") ? "on" : "off");`,
      "typeof-feature undefined on",
    ],
  };

  const sourcesOf = (rows: Record<string, readonly [source: string, ...rest: string[]]>) =>
    Object.fromEntries(Object.entries(rows).map(([file, [source]]) => [file, source]));

  for (const backend of ["cli", "api"] as const) {
    itBundled(`feature_flag/${backend}/RefusesDefaultAndNamespaceImports`, {
      backend,
      files: sourcesOf(refused),
      entryPoints: Object.keys(refused),
      features: ["FLAG"],
      bundleErrors: Object.fromEntries(Object.entries(refused).map(([file, [, ...errors]]) => [file, errors])),
    });

    itBundled(`feature_flag/${backend}/AcceptsEveryOtherImportForm`, {
      backend,
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
    });
  }

  test("the namespace error names the import to write instead", async () => {
    using dir = tempDir("bundler-feature-flag", {
      "namespace.js": `import * as flags from "bun:bundle"; console.log(flags);`,
      "namespace.ts": `import * as B from "bun:bundle"; const r: B.Registry = {}; console.log(r);`,
    });
    const logsOf = async (file: string) => {
      const build = await Bun.build({ entrypoints: [`${dir}/${file}`], throw: false });
      return build.logs.map(log => ({
        message: log.message,
        at: [log.position?.line, log.position?.column],
        notes: log.notes.map(note => note.message),
      }));
    };
    const named = `"bun:bundle" does not exist at runtime. Use a named import: import { feature } from "bun:bundle"`;

    expect(await logsOf("namespace.js")).toEqual([{ message: NAMESPACE, at: [1, 13], notes: [named] }]);
    // In TypeScript the namespace can be there for its types alone.
    expect(await logsOf("namespace.ts")).toEqual([
      {
        message: NAMESPACE,
        at: [1, 13],
        notes: [named, `To use only its types, write: import type * as B from "bun:bundle"`],
      },
    ]);
  });

  async function spawnBun(cwd: string, ...args: string[]) {
    await using proc = Bun.spawn({ cmd: [bunExe(), ...args], cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.concurrent.each([
    [
      "a namespace import",
      `import * as flags from "bun:bundle"; console.log("ran", flags.feature("FLAG"));`,
      NAMESPACE,
    ],
    ["a default import", `import flags from "bun:bundle"; console.log("ran", flags.feature("FLAG"));`, DEFAULT],
    [
      "a default import beside feature",
      `import flags, { feature } from "bun:bundle"; console.log("ran", feature("FLAG") ? 1 : 2, typeof flags);`,
      DEFAULT,
    ],
  ])("every way to run a file refuses %s", async (_, source, error) => {
    using dir = tempDir("bundler-feature-flag", { "index.ts": source, "index.test.ts": source });
    const ways = {
      "bun run": ["run", "./index.ts"],
      "bun build --no-bundle": ["build", "--no-bundle", "./index.ts"],
      "bun --print": ["--print", `${source} "printed"`],
      "bun test": ["test", "./index.test.ts"],
      "bun test --coverage": ["test", "--coverage", "./index.test.ts"],
    };
    const results = await Promise.all(Object.values(ways).map(args => spawnBun(String(dir), ...args)));

    // The file does not load, so nothing of it runs or is printed.
    expect(
      Object.fromEntries(
        Object.keys(ways).map((way, index) => {
          const { stdout, stderr, exitCode } = results[index];
          return [way, { refused: stderr.includes(error), ran: /ran|printed/.test(stdout), exitCode }];
        }),
      ),
    ).toEqual(Object.fromEntries(Object.keys(ways).map(way => [way, { refused: true, ran: false, exitCode: 1 }])));
  });

  test("Bun.Transpiler refuses them too", () => {
    const errorsOf = (fn: () => unknown): string[] => {
      try {
        fn();
      } catch (e: any) {
        return (e instanceof AggregateError ? e.errors : [e]).map(error => error.message);
      }
      return [];
    };
    const transpiler = new Bun.Transpiler({ loader: "ts" });

    for (const [file, [source, ...errors]] of Object.entries(refused)) {
      // scanImports() and scan() only parse. The statement is refused while parsing.
      expect({
        file,
        scanImports: errorsOf(() => transpiler.scanImports(source)),
        scan: errorsOf(() => transpiler.scan(source)),
        transformSync: errorsOf(() => transpiler.transformSync(source)),
      }).toEqual({ file, scanImports: errors, scan: errors, transformSync: errors });
    }
    for (const [file, [source]] of Object.entries(accepted)) {
      expect({ file, transformSync: errorsOf(() => transpiler.transformSync(source)) }).toEqual({
        file,
        transformSync: [],
      });
    }
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
