import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/3768
//
// app.tsx is transpiled twice per case: once by `bun run` (NODE_ENV comes from the
// environment) and once by the Bun.build() call inside it, which defines
// process.env.NODE_ENV to CHILD_NODE_ENV and then executes the bundle it produced.
// The stub `react` runtimes return their own name, so each pass prints which runtime
// the entry point and the file it imports were compiled against. (This used to render
// with the real react-dom and bundle it; that took several seconds per case on debug
// builds, and the 32 concurrent cases timed out.)
const files = {
  "node_modules/react/jsx-runtime.js": /* js */ `
    export const Fragment = Symbol.for("react.fragment");
    export const jsx = () => "jsx";
    export const jsxs = jsx;
  `,
  "node_modules/react/jsx-dev-runtime.js": /* js */ `
    export const Fragment = Symbol.for("react.fragment");
    export const jsxDEV = () => "jsxDEV";
  `,
  "child.tsx": /* tsx */ `
    export const child = <span />;
  `,
  "app.tsx": /* tsx */ `
    import { child } from "./child";

    console.log(process.env.BUNDLED ? "bundle:" : "run:", <div />, child);

    if (!process.env.BUNDLED) {
      const build = await Bun.build({
        entrypoints: [import.meta.path],
        define: {
          "process.env.NODE_ENV": JSON.stringify(process.env.CHILD_NODE_ENV),
          "process.env.BUNDLED": "1",
        },
      });
      await import(URL.createObjectURL(build.outputs[0]));
    }
  `,
};

const runtimes = ["jsx", "jsxDEV"];
const nodeEnvs = ["production", "development", "test", ""];

describe.concurrent("jsx", () => {
  for (const jsx of ["react-jsx", "react-jsxdev"]) {
    for (const node_env of nodeEnvs) {
      for (const child_node_env of nodeEnvs) {
        test(`tsconfig ${jsx}, NODE_ENV=${JSON.stringify(node_env)}, bundle defines NODE_ENV=${JSON.stringify(child_node_env)}`, async () => {
          using dir = tempDir("jsx-production", {
            ...files,
            "tsconfig.json": JSON.stringify({ compilerOptions: { jsx } }),
          });
          await using proc = Bun.spawn({
            cmd: [bunExe(), "run", "app.tsx"],
            cwd: String(dir),
            env: { ...bunEnv, BUN_ENV: undefined, NODE_ENV: node_env, CHILD_NODE_ENV: child_node_env },
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

          // NODE_ENV=production selects the production runtime in both passes, and a bundle
          // whose define says "development" selects jsxDEV no matter what the parent process
          // or tsconfig said. The remaining combinations fall back to the tsconfig and the
          // parent environment; they are not pinned here, but both passes still have to pick
          // a runtime that exists and compile both files against the same one.
          const runPass = node_env === "production" ? ["jsx"] : runtimes;
          const bundlePass =
            child_node_env === "production" ? ["jsx"] : child_node_env === "development" ? ["jsxDEV"] : runtimes;
          expect(stderr).toBe("");
          expect(stdout).toBeOneOf(runPass.flatMap(r => bundlePass.map(b => `run: ${r} ${r}\nbundle: ${b} ${b}\n`)));
          expect(exitCode).toBe(0);
        });
      }
    }
  }
});
