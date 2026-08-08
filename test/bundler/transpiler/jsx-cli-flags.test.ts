import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Passing a --jsx-* CLI flag must not flip the automatic runtime from
// jsx-dev-runtime (development) to jsx-runtime (production). The flag only
// overrides the field it names; dev/prod selection follows NODE_ENV exactly as
// it does when no --jsx-* flag is present.
describe.concurrent("jsx: --jsx-* CLI flags preserve development runtime", () => {
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

  type Case = [extraArgs: string[], nodeEnv: string | undefined, bunfig: string | undefined, expected: "DEV" | "PROD"];
  const cases: Case[] = [
    // Baselines (no --jsx-* flags): dev by default, prod only when NODE_ENV=production.
    [[], undefined, undefined, "DEV"],
    [[], "development", undefined, "DEV"],
    [[], "production", undefined, "PROD"],
    // Any --jsx-* flag must not change the dev/prod selection (no bunfig: fresh-construct branch).
    [["--jsx-import-source=react"], undefined, undefined, "DEV"],
    [["--jsx-import-source=react"], "development", undefined, "DEV"],
    [["--jsx-import-source=react"], "production", undefined, "PROD"],
    [["--jsx-fragment=Fragment"], undefined, undefined, "DEV"],
    [["--jsx-fragment=Fragment"], "development", undefined, "DEV"],
    [["--jsx-fragment=Fragment"], "production", undefined, "PROD"],
    [["--jsx-factory=h"], undefined, undefined, "DEV"],
    [["--jsx-runtime=automatic"], undefined, undefined, "DEV"],
    [["--jsx-runtime=automatic"], "production", undefined, "PROD"],
    // With a bunfig present, opts.jsx is already populated and CLI flags go through the
    // merge-with-bunfig branch, which must preserve bunfig's `development` value.
    [["--jsx-import-source=react"], undefined, "", "DEV"],
    [["--jsx-import-source=react"], "production", "", "PROD"],
    [["--jsx-fragment=Fragment"], undefined, "", "DEV"],
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
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...extraArgs, "a.jsx"],
        env,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe(JSON.stringify({ rt: expected }));
      expect(exitCode).toBe(0);
    });
  }
});
