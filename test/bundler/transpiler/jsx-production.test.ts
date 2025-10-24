import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
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
