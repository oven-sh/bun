import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("tsconfig extends non-existent file shows warning", () => {
  const dir = tempDirWithFiles("02804", {
    "tsconfig.json": JSON.stringify({
      extends: "./nonexistent-config.json",
      compilerOptions: {
        strict: true,
      },
    }),
    "index.ts": `const x: string = "hello"; console.log(x);`,
  });

  const proc = Bun.spawnSync([bunExe(), "index.ts"], {
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const stderr = proc.stderr.toString("utf-8");
  expect(stderr).toContain('Cannot find base config file "./nonexistent-config.json"');
  expect(stderr).toContain("warn:");
});

test("tsconfig extends inside node_modules does not warn", () => {
  const dir = tempDirWithFiles("02804-node-modules", {
    "index.ts": `import "./node_modules/foo/index.js"; console.log("done");`,
    "node_modules/foo/tsconfig.json": JSON.stringify({
      extends: "./nonexistent-config.json",
    }),
    "node_modules/foo/index.js": `console.log("foo");`,
  });

  const proc = Bun.spawnSync([bunExe(), "index.ts"], {
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const stderr = proc.stderr.toString("utf-8");
  // Should NOT show warning for files inside node_modules
  expect(stderr).not.toContain("Cannot find base config file");
});
