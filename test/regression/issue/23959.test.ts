// https://github.com/oven-sh/bun/issues/23959
//
// A tsconfig.json with `"jsx": "react-jsx"` was clobbering both
// `NODE_ENV=production` and `--define process.env.NODE_ENV="production"` in
// `bun build`, forcing the dev JSX runtime (`react/jsx-dev-runtime`). Only
// `--production` survived. React's production `jsx-dev-runtime` exports
// `jsxDEV = undefined`, so the resulting bundle TypeErrors at first render.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const entry = `const el = <div prop="1">x</div>;\nexport default el;\n`;

async function buildAndGetRuntime(opts: {
  tsconfigJsx?: string;
  env?: Record<string, string | undefined>;
  extraArgs?: string[];
}): Promise<{ runtime: string; stdout: string; stderr: string }> {
  const files: Record<string, string> = { "index.jsx": entry };
  if (opts.tsconfigJsx) {
    files["tsconfig.json"] = JSON.stringify({ compilerOptions: { jsx: opts.tsconfigJsx } });
  }
  using dir = tempDir("jsx-tsconfig-prod", files);

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "build",
      "./index.jsx",
      "--target=browser",
      "--external",
      "react",
      "--external",
      "react/*",
      ...(opts.extraArgs ?? []),
    ],
    env: { ...bunEnv, NODE_ENV: undefined, ...opts.env },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const matches = stdout.match(/react\/jsx[a-z-]*runtime/g) ?? [];
  const unique = [...new Set(matches)];
  if (exitCode !== 0 || unique.length !== 1) {
    throw new Error(`bun build exited ${exitCode}; runtimes=${JSON.stringify(unique)}\nstderr:\n${stderr}\nstdout:\n${stdout}`);
  }
  return { runtime: unique[0], stdout, stderr };
}

describe("bun build: tsconfig jsx vs NODE_ENV=production", () => {
  test.concurrent("tsconfig react-jsx + NODE_ENV=production env uses production JSX runtime", async () => {
    const { runtime, stdout } = await buildAndGetRuntime({
      tsconfigJsx: "react-jsx",
      env: { NODE_ENV: "production" },
    });
    expect(runtime).toBe("react/jsx-runtime");
    expect(stdout).not.toContain("jsxDEV");
  });

  test.concurrent(
    "tsconfig react-jsx + --define process.env.NODE_ENV=production uses production JSX runtime",
    async () => {
      const { runtime, stdout } = await buildAndGetRuntime({
        tsconfigJsx: "react-jsx",
        extraArgs: ["--define", 'process.env.NODE_ENV="production"'],
      });
      expect(runtime).toBe("react/jsx-runtime");
      expect(stdout).not.toContain("jsxDEV");
    },
  );

  test.concurrent("tsconfig react-jsxdev + NODE_ENV=production env uses production JSX runtime", async () => {
    const { runtime } = await buildAndGetRuntime({
      tsconfigJsx: "react-jsxdev",
      env: { NODE_ENV: "production" },
    });
    expect(runtime).toBe("react/jsx-runtime");
  });

  test.concurrent("tsconfig react-jsx + --production uses production JSX runtime", async () => {
    const { runtime } = await buildAndGetRuntime({
      tsconfigJsx: "react-jsx",
      extraArgs: ["--production"],
    });
    expect(runtime).toBe("react/jsx-runtime");
  });

  test.concurrent("tsconfig react-jsx without NODE_ENV still uses dev JSX runtime", async () => {
    const { runtime } = await buildAndGetRuntime({
      tsconfigJsx: "react-jsx",
    });
    expect(runtime).toBe("react/jsx-dev-runtime");
  });

  test.concurrent("no tsconfig + NODE_ENV=production uses production JSX runtime", async () => {
    const { runtime } = await buildAndGetRuntime({
      env: { NODE_ENV: "production" },
    });
    expect(runtime).toBe("react/jsx-runtime");
  });

  test.concurrent("tsconfig react-jsx + NODE_ENV=development uses dev JSX runtime", async () => {
    const { runtime } = await buildAndGetRuntime({
      tsconfigJsx: "react-jsx",
      env: { NODE_ENV: "development" },
    });
    expect(runtime).toBe("react/jsx-dev-runtime");
  });
});
