import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// A shim `react` package whose two runtime entry points report which one was
// imported.
const shimFiles = {
  "node_modules/react/package.json": JSON.stringify({
    name: "react",
    version: "1.0.0",
    exports: {
      ".": "./index.js",
      "./jsx-runtime": "./prod.js",
      "./jsx-dev-runtime": "./dev.js",
    },
  }),
  "node_modules/react/index.js": "module.exports = {};",
  "node_modules/react/prod.js":
    "exports.jsx = () => ({ rt: 'PROD' }); exports.jsxs = exports.jsx; exports.Fragment = {};",
  "node_modules/react/dev.js": "exports.jsxDEV = () => ({ rt: 'DEV' }); exports.Fragment = {};",
  "a.jsx": "console.log(JSON.stringify(<div/>));",
};

async function spawn(args: string[], cwd: string, env: Record<string, string | undefined> = bunEnv) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  return { stdout, exitCode };
}

// A --jsx-* CLI flag only overrides the field it names. It must not flip the
// automatic runtime from jsx-dev-runtime (development) to jsx-runtime
// (production). Dev/prod selection follows NODE_ENV and bunfig exactly as it
// does when no --jsx-* flag is present.
describe.concurrent("jsx: --jsx-* CLI flags preserve the development runtime", () => {
  type Case = [extraArgs: string[], nodeEnv: string | undefined, bunfig: string | undefined, expected: "DEV" | "PROD"];
  const cases: Case[] = [
    // Baselines (no --jsx-* flags): dev by default, prod only when NODE_ENV=production.
    [[], undefined, undefined, "DEV"],
    [[], "development", undefined, "DEV"],
    [[], "production", undefined, "PROD"],
    // No bunfig: the CLI flags create the jsx options from scratch.
    [["--jsx-import-source=react"], undefined, undefined, "DEV"],
    [["--jsx-import-source=react"], "development", undefined, "DEV"],
    [["--jsx-import-source=react"], "production", undefined, "PROD"],
    [["--jsx-fragment=Fragment"], undefined, undefined, "DEV"],
    [["--jsx-fragment=Fragment"], "development", undefined, "DEV"],
    [["--jsx-fragment=Fragment"], "production", undefined, "PROD"],
    [["--jsx-factory=h"], undefined, undefined, "DEV"],
    [["--jsx-runtime=automatic"], undefined, undefined, "DEV"],
    [["--jsx-runtime=automatic"], "production", undefined, "PROD"],
    [["--jsx-side-effects"], undefined, undefined, "DEV"],
    [["--jsx-side-effects"], "production", undefined, "PROD"],
    // With a bunfig present, the jsx options already exist and the CLI flags
    // are merged into them. bunfig's `jsx` value must survive.
    [["--jsx-import-source=react"], undefined, "", "DEV"],
    [["--jsx-import-source=react"], "production", "", "PROD"],
    [["--jsx-fragment=Fragment"], undefined, "", "DEV"],
    [["--jsx-side-effects"], undefined, "", "DEV"],
    [["--jsx-import-source=react"], undefined, 'jsx = "react-jsx"\n', "PROD"],
    [["--jsx-import-source=react"], undefined, 'jsx = "react-jsxDEV"\n', "DEV"],
  ];

  for (const [extraArgs, nodeEnv, bunfig, expected] of cases) {
    const bunfigLabel = bunfig === undefined ? "no bunfig" : bunfig === "" ? "empty bunfig" : `bunfig ${bunfig.trim()}`;
    const label = `bun ${extraArgs.join(" ") || "(no flags)"} NODE_ENV=${nodeEnv ?? "<unset>"} [${bunfigLabel}] -> ${expected}`;
    test(label, async () => {
      const files: Record<string, string> = { ...shimFiles };
      if (bunfig !== undefined) files["bunfig.toml"] = bunfig;
      using dir = tempDir("jsx-cli-dev", files);
      const env: Record<string, string | undefined> = { ...bunEnv, NODE_ENV: nodeEnv };
      if (nodeEnv === undefined) delete env.NODE_ENV;
      const { stdout, exitCode } = await spawn([...extraArgs, "a.jsx"], String(dir), env);
      expect(stdout.trim()).toBe(JSON.stringify({ rt: expected }));
      expect(exitCode).toBe(0);
    });
  }
});

// The root tsconfig.json `"jsx"` setting picks dev/prod the same way for
// `bun <file>`, `bun build --no-bundle` and a bundling `bun build`, whether or
// not a --jsx-* flag or a bunfig.toml is present.
describe.concurrent("jsx: tsconfig dev/prod selection agrees across run, --no-bundle and bundle", () => {
  const tsconfigs: [label: string, contents: string | undefined, expected: "DEV" | "PROD"][] = [
    ["no tsconfig", undefined, "DEV"],
    ["tsconfig {}", JSON.stringify({ compilerOptions: {} }), "DEV"],
    ['tsconfig "react-jsx"', JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }), "PROD"],
    ['tsconfig "react-jsxdev"', JSON.stringify({ compilerOptions: { jsx: "react-jsxdev" } }), "DEV"],
  ];
  const flagSets: string[][] = [[], ["--jsx-side-effects"], ["--jsx-import-source=react"]];
  const modes = {
    "run": (flags: string[]) => [...flags, "a.jsx"],
    "--no-bundle": (flags: string[]) => ["build", "--no-bundle", ...flags, "a.jsx"],
    "bundle": (flags: string[]) => ["build", "--external", "react", ...flags, "a.jsx"],
  } as const;
  const runtimeOf = (mode: keyof typeof modes, stdout: string): "DEV" | "PROD" => {
    if (mode === "run") return JSON.parse(stdout.trim()).rt;
    if (stdout.includes("react/jsx-dev-runtime")) return "DEV";
    expect(stdout).toContain("react/jsx-runtime");
    return "PROD";
  };

  type Case = [label: string, files: Record<string, string>, flags: string[], expected: "DEV" | "PROD"];
  const cases: Case[] = [];
  for (const [label, tsconfig, expected] of tsconfigs) {
    for (const flags of flagSets) {
      cases.push([label, tsconfig === undefined ? {} : { "tsconfig.json": tsconfig }, flags, expected]);
    }
  }
  // A bunfig.toml without a `jsx` key leaves dev/prod to the tsconfig too.
  for (const flags of [[], ["--jsx-side-effects"]]) {
    cases.push([
      'tsconfig "react-jsx" + bunfig',
      {
        "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }),
        "bunfig.toml": 'logLevel = "error"\n',
      },
      flags,
      "PROD",
    ]);
  }

  for (const [label, files, flags, expected] of cases) {
    for (const mode of Object.keys(modes) as (keyof typeof modes)[]) {
      test(`${mode} ${flags.join(" ") || "(no flags)"} [${label}] -> ${expected}`, async () => {
        using dir = tempDir("jsx-cli-tsconfig", { ...shimFiles, ...files });
        const { stdout, exitCode } = await spawn(modes[mode](flags), String(dir));
        expect(runtimeOf(mode, stdout)).toBe(expected);
        expect(exitCode).toBe(0);
      });
    }
  }
});
