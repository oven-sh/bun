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

      itBundled(`feature_flag/${backend}/MultipleIfStatements`, {
        backend,
        files: {
          "/a.js": `
import { feature } from "bun:bundle";
// Multiple flags in separate if statements (allowed)
if (feature("FLAG_A")) {
  console.log("A enabled");
}
if (feature("FLAG_B")) {
  console.log("B enabled");
}
if (feature("FLAG_C")) {
  console.log("C enabled");
}
`,
        },
        features: ["FLAG_A", "FLAG_C"],
        minifySyntax: true,
        onAfterBundle(api) {
          // FLAG_A and FLAG_C are enabled, FLAG_B is not
          api.expectFile("out.js").toInclude("A enabled");
          api.expectFile("out.js").not.toInclude("B enabled");
          api.expectFile("out.js").toInclude("C enabled");
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
          api.expectFile("out.js").not.toInclude("feature");
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

  // Tests for disallowed patterns - feature() must only be used as sole condition
  itBundled("feature_flag/VariableAssignmentError", {
    backend: "cli",
    files: {
      "/a.js": `
import { feature } from "bun:bundle";
const FLAG = feature("TEST");
console.log(FLAG);
`,
    },
    bundleErrors: {
      "/a.js": ["feature() can only be used as the sole condition of an if statement or ternary expression"],
    },
  });

  itBundled("feature_flag/ComplexExpressionOrError", {
    backend: "cli",
    files: {
      "/a.js": `
import { feature } from "bun:bundle";
const isAdmin = true;
if (feature("ADMIN_FEATURE") || isAdmin) {
  console.log("admin access");
}
`,
    },
    bundleErrors: {
      "/a.js": ["feature() can only be used as the sole condition of an if statement or ternary expression"],
    },
  });

  itBundled("feature_flag/ComplexExpressionAndError", {
    backend: "cli",
    files: {
      "/a.js": `
import { feature } from "bun:bundle";
const isEnabled = true;
if (feature("FLAG") && isEnabled) {
  console.log("both conditions met");
}
`,
    },
    bundleErrors: {
      "/a.js": ["feature() can only be used as the sole condition of an if statement or ternary expression"],
    },
  });

  itBundled("feature_flag/FunctionArgumentError", {
    backend: "cli",
    files: {
      "/a.js": `
import { feature } from "bun:bundle";
function check(flag) { return flag; }
if (check(feature("FLAG"))) {
  console.log("checked");
}
`,
    },
    bundleErrors: {
      "/a.js": ["feature() can only be used as the sole condition of an if statement or ternary expression"],
    },
  });

  itBundled("feature_flag/ArrayElementError", {
    backend: "cli",
    files: {
      "/a.js": `
import { feature } from "bun:bundle";
const flags = [feature("FLAG_A"), feature("FLAG_B")];
console.log(flags);
`,
    },
    bundleErrors: {
      "/a.js": [
        "feature() can only be used as the sole condition of an if statement or ternary expression",
        "feature() can only be used as the sole condition of an if statement or ternary expression",
      ],
    },
  });

  itBundled("feature_flag/ObjectPropertyError", {
    backend: "cli",
    files: {
      "/a.js": `
import { feature } from "bun:bundle";
const config = { enabled: feature("FLAG") };
console.log(config);
`,
    },
    bundleErrors: {
      "/a.js": ["feature() can only be used as the sole condition of an if statement or ternary expression"],
    },
  });

  itBundled("feature_flag/ReturnStatementError", {
    backend: "cli",
    files: {
      "/a.js": `
import { feature } from "bun:bundle";
function getFlag() {
  return feature("FLAG");
}
console.log(getFlag());
`,
    },
    bundleErrors: {
      "/a.js": ["feature() can only be used as the sole condition of an if statement or ternary expression"],
    },
  });

  itBundled("feature_flag/ExportedVariableError", {
    backend: "cli",
    files: {
      "/a.js": `
import { feature } from "bun:bundle";
export const FLAG = feature("TEST");
`,
    },
    bundleErrors: {
      "/a.js": ["feature() can only be used as the sole condition of an if statement or ternary expression"],
    },
  });

  itBundled("feature_flag/ReExportFromModuleError", {
    backend: "cli",
    files: {
      "/a.js": `
import { FLAG } from "./b.js";
if (FLAG) {
  console.log("enabled");
}
`,
      "/b.js": `
import { feature } from "bun:bundle";
export const FLAG = feature("TEST");
`,
    },
    bundleErrors: {
      "/b.js": ["feature() can only be used as the sole condition of an if statement or ternary expression"],
    },
  });

  itBundled("feature_flag/TernaryConditionNotSoleError", {
    backend: "cli",
    files: {
      "/a.js": `
import { feature } from "bun:bundle";
const isAdmin = true;
const result = (feature("FLAG") && isAdmin) ? "yes" : "no";
console.log(result);
`,
    },
    bundleErrors: {
      "/a.js": ["feature() can only be used as the sole condition of an if statement or ternary expression"],
    },
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
