import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

// https://github.com/oven-sh/bun/issues/20141
// Test coverage was incorrect for compile-time constant conditions.
// The transpiler folds equality expressions like `2 === 2` into `true`,
// then JSC's ControlFlowProfiler marks the if-body as not executed because
// it doesn't create proper basic blocks for constant-condition branches.
// Fix: when coverage is enabled, unwrap if-statements with constant
// conditions so JSC doesn't create a branch in the first place.

test("coverage: while(true) + if(2 === 2) shows 100%", () => {
  const dir = tempDirWithFiles("cov-20141", {
    "src.ts": `
export function repro(): undefined {
    while(true) {
        if(2 === 2) {
            break;
        }
    }
}
`,
    "test.test.ts": `
import { test, expect } from "bun:test";
import { repro } from "./src";

test("repro", () => {
    repro();
    expect(true).toBe(true);
});
`,
  });

  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: String(dir),
    env: { ...bunEnv },
    stdio: [null, null, "pipe"],
  });

  const stderr = result.stderr.toString("utf-8");

  // The coverage output should show 100% line coverage for src.ts
  // Previously it showed 66.67% with lines 4-5 uncovered
  expect(stderr).toContain("src.ts");
  expect(stderr).toMatch(/src\.ts\s*\|\s*100\.00\s*\|\s*100\.00/);
  expect(result.exitCode).toBe(0);
});

test("coverage: if(true) with else shows 100%", () => {
  const dir = tempDirWithFiles("cov-20141b", {
    "src.ts": `
export function repro(): string {
    if(true) {
        return "yes";
    } else {
        return "no";
    }
}
`,
    "test.test.ts": `
import { test, expect } from "bun:test";
import { repro } from "./src";

test("repro", () => {
    expect(repro()).toBe("yes");
});
`,
  });

  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: String(dir),
    env: { ...bunEnv },
    stdio: [null, null, "pipe"],
  });

  const stderr = result.stderr.toString("utf-8");

  // Previously showed 60.00% with body marked uncovered
  expect(stderr).toContain("src.ts");
  expect(stderr).toMatch(/src\.ts\s*\|\s*100\.00\s*\|\s*100\.00/);
  expect(result.exitCode).toBe(0);
});

test("coverage: const x = 2; if(x === 2) shows 100%", () => {
  const dir = tempDirWithFiles("cov-20141c", {
    "src.ts": `
export function repro(): undefined {
    const x = 2;
    if(x === 2) {
        return;
    } else {
        return;
    }
}
`,
    "test.test.ts": `
import { test, expect } from "bun:test";
import { repro } from "./src";

test("repro", () => {
    repro();
    expect(true).toBe(true);
});
`,
  });

  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: String(dir),
    env: { ...bunEnv },
    stdio: [null, null, "pipe"],
  });

  const stderr = result.stderr.toString("utf-8");

  // Previously showed 66.67% with body marked uncovered
  expect(stderr).toContain("src.ts");
  expect(stderr).toMatch(/src\.ts\s*\|\s*100\.00\s*\|\s*100\.00/);
  expect(result.exitCode).toBe(0);
});

test("coverage: runtime conditions still report correctly", () => {
  const dir = tempDirWithFiles("cov-20141d", {
    "src.ts": `
export function repro(): undefined {
    let i = 0;
    while(true) {
        i++;
        if(i >= 3) {
            break;
        }
    }
}
`,
    "test.test.ts": `
import { test, expect } from "bun:test";
import { repro } from "./src";

test("repro", () => {
    repro();
    expect(true).toBe(true);
});
`,
  });

  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: String(dir),
    env: { ...bunEnv },
    stdio: [null, null, "pipe"],
  });

  const stderr = result.stderr.toString("utf-8");

  // Runtime conditions should still show 100% when fully exercised
  expect(stderr).toContain("src.ts");
  expect(stderr).toMatch(/src\.ts\s*\|\s*100\.00\s*\|\s*100\.00/);
  expect(result.exitCode).toBe(0);
});
