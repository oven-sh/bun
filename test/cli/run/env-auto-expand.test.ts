import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, tempDirWithFiles } from "harness";

describe("env.autoExpand in bunfig.toml", () => {
  test("autoExpand: true - variable expansion works (default behavior)", () => {
    const dir = tempDirWithFiles("dotenv-auto-expand-true", {
      "bunfig.toml": `
[env]
autoExpand = true
`,
      ".env": "FOO=foo\nBAR=$FOO bar\nMOO=${FOO} ${BAR:-fail} ${MOZ:-moo}",
      "index.ts": "console.log([process.env.FOO, process.env.BAR, process.env.MOO].join('|'));",
    });
    const { stdout } = bunRun(`${dir}/index.ts`);
    expect(stdout).toBe("foo|foo bar|foo foo bar moo");
  });

  test("autoExpand: false - variable expansion is disabled", () => {
    const dir = tempDirWithFiles("dotenv-auto-expand-false", {
      "bunfig.toml": `
[env]
autoExpand = false
`,
      ".env": "FOO=foo\nBAR=$FOO bar\nMOO=${FOO} ${BAR:-fail} ${MOZ:-moo}",
      "index.ts": "console.log([process.env.FOO, process.env.BAR, process.env.MOO].join('|'));",
    });
    const { stdout } = bunRun(`${dir}/index.ts`);
    expect(stdout).toBe("foo|$FOO bar|${FOO} ${BAR:-fail} ${MOZ:-moo}");
  });

  test("autoExpand not specified - defaults to true (expansion enabled)", () => {
    const dir = tempDirWithFiles("dotenv-auto-expand-default", {
      "bunfig.toml": `
# no env.autoExpand setting
`,
      ".env": "FOO=foo\nBAR=$FOO bar",
      "index.ts": "console.log([process.env.FOO, process.env.BAR].join('|'));",
    });
    const { stdout } = bunRun(`${dir}/index.ts`);
    expect(stdout).toBe("foo|foo bar");
  });

  test("autoExpand: false with different expansion patterns", () => {
    const dir = tempDirWithFiles("dotenv-auto-expand-patterns", {
      "bunfig.toml": `
[env]
autoExpand = false
`,
      ".env": "BASE=base\nSIMPLE=$BASE\nBRACED=${BASE}\nWITH_DEFAULT=${MISSING:-default}\nNESTED=${BASE}_${BASE}",
      "index.ts": "console.log([process.env.BASE, process.env.SIMPLE, process.env.BRACED, process.env.WITH_DEFAULT, process.env.NESTED].join('|'));",
    });
    const { stdout } = bunRun(`${dir}/index.ts`);
    expect(stdout).toBe("base|$BASE|${BASE}|${MISSING:-default}|${BASE}_${BASE}");
  });

  test("autoExpand: false with escaped dollar signs", () => {
    const dir = tempDirWithFiles("dotenv-auto-expand-escaped", {
      "bunfig.toml": `
[env]
autoExpand = false
`,
      ".env": "FOO=foo\nBAR=\\$FOO\nMOO=\\$\\$FOO",
      "index.ts": "console.log([process.env.FOO, process.env.BAR, process.env.MOO].join('|'));",
    });
    const { stdout } = bunRun(`${dir}/index.ts`);
    // When autoExpand is false, escaped dollar signs should remain as-is
    expect(stdout).toBe("foo|\\$FOO|\\$\\$FOO");
  });
});