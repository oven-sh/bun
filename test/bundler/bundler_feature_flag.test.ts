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
