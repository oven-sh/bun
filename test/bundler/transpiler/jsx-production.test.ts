import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";

// https://github.com/oven-sh/bun/issues/3768
describe.concurrent("jsx", () => {
  for (const node_env of ["production", "development", "test", ""]) {
    for (const child_node_env of ["production", "development", "test", ""]) {
      test(`react-jsxDEV parent: ${node_env} child: ${child_node_env} should work`, async () => {
        const env = { ...bunEnv };
        env.NODE_ENV = node_env;
        env.CHILD_NODE_ENV = child_node_env;
        env.TSCONFIG_JSX = "react-jsxdev";
        await using proc = Bun.spawn({
          cmd: [bunExe(), "run", path.join(import.meta.dirname, "jsx-dev", "jsx-dev.tsx")],
          cwd: import.meta.dirname,
          env: env,
          stdout: "pipe",
          stderr: "inherit",
          stdin: "ignore",
        });
        const out = await new Response(proc.stdout).text();
        expect(out).toBe("<div>Hello World</div>" + "\n" + "<div>Hello World</div>" + "\n");
        expect(await proc.exited).toBe(0);
      });

      test(`react-jsx parent: ${node_env} child: ${child_node_env} should work`, async () => {
        const env = { ...bunEnv };
        env.NODE_ENV = node_env;
        env.CHILD_NODE_ENV = child_node_env;
        env.TSCONFIG_JSX = "react-jsx";
        await using proc = Bun.spawn({
          cmd: [bunExe(), "run", path.join(import.meta.dirname, "jsx-production-entry.ts")],
          cwd: import.meta.dirname,
          env: env,
          stdout: "pipe",
          stderr: "inherit",
          stdin: "ignore",
        });
        const out = await new Response(proc.stdout).text();
        expect(out).toBe("<div>Hello World</div>" + "\n" + "<div>Hello World</div>" + "\n");
        expect(await proc.exited).toBe(0);
      });
    }
  }
});

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

  const cases: Array<[extraArgs: string[], nodeEnv: string | undefined, expected: "DEV" | "PROD"]> = [
    // Baselines (no --jsx-* flags): dev by default, prod only when NODE_ENV=production.
    [[], undefined, "DEV"],
    [[], "development", "DEV"],
    [[], "production", "PROD"],
    // Any --jsx-* flag must not change the dev/prod selection.
    [["--jsx-import-source=react"], undefined, "DEV"],
    [["--jsx-import-source=react"], "development", "DEV"],
    [["--jsx-import-source=react"], "production", "PROD"],
    [["--jsx-fragment=Fragment"], undefined, "DEV"],
    [["--jsx-fragment=Fragment"], "development", "DEV"],
    [["--jsx-fragment=Fragment"], "production", "PROD"],
    [["--jsx-factory=h"], undefined, "DEV"],
    [["--jsx-runtime=automatic"], undefined, "DEV"],
    [["--jsx-runtime=automatic"], "production", "PROD"],
  ];

  for (const [extraArgs, nodeEnv, expected] of cases) {
    const label = `bun ${extraArgs.join(" ") || "(no flags)"} NODE_ENV=${nodeEnv ?? "<unset>"} -> ${expected}`;
    test(label, async () => {
      using dir = tempDir("jsx-cli-dev", shimFiles);
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
