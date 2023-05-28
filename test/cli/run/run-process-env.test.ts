import { describe, expect, test } from "bun:test";
import { tempDirWithFiles } from "./env.test";
import { bunEnv, bunExe } from "harness";

function bunRunAsScript(dir: string, script: string, env?: Record<string, string>) {
    const result = Bun.spawnSync([bunExe(), `run`, `${script}`], {
      cwd: dir,
      env: {
        ...bunEnv,
        NODE_ENV: undefined,
        ...env,
      },
    });

    if (!result.success)
        throw new Error(result.stderr.toString("utf8"));

    return {
      stdout: result.stdout.toString("utf8").trim(),
      stderr: result.stderr.toString("utf8").trim(),
    };
}

describe("process.env", () => {
  test("npm_lifecycle_event", () => {
    const scriptName = 'start:dev';

    const dir = tempDirWithFiles("processenv", {
      "package.json": `{'scripts': {'${scriptName}': 'bun run index.ts'}}`,
      "index.ts": "console.log(process.env.npm_lifecycle_event);",
    });
    
    const { stdout } = bunRunAsScript(dir, scriptName);
    expect(stdout).toBe(scriptName);
  });
});