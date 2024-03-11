import { SpawnOptions, Subprocess, SyncSubprocess } from "bun";
import { describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { tmpdir } from "os";
import { join, sep } from "path";

describe("bun -e", () => {
  test("it works", async () => {
    const { stdout } = Bun.spawnSync([bunExe(), "-e", 'console.log("hello world")'], {
      env: bunEnv,
    });
    expect(stdout.toString("utf8")).toEqual("hello world\n");
  });

  test("import, tsx, require in esm, import.meta", async () => {
    const ref = await import("react");
    const { stdout } = Bun.spawnSync(
      [
        bunExe(),
        "-e",
        'import {version} from "react"; console.log(JSON.stringify({version,file:import.meta.path,require:require("react").version})); console.log(<hello>world</hello>);',
      ],
      {
        env: bunEnv,
      },
    );
    const json = {
      version: ref.version,
      file: join(process.cwd(), "[eval]"),
      require: ref.version,
    };
    expect(stdout.toString("utf8")).toEqual(JSON.stringify(json) + "\n<hello>world</hello>\n");
  });

  test("error has source map info 1", async () => {
    let { stderr } = Bun.spawnSync([bunExe(), "-e", '(throw new Error("hi" as 2))'], {
      env: bunEnv,
    });
    expect(stderr.toString("utf8")).toInclude('"hi" as 2');
    expect(stderr.toString("utf8")).toInclude("Unexpected throw");
  });
});

function group(run: (code: string) => SyncSubprocess<"pipe", "inherit">) {
  test("it works", async () => {
    const { stdout } = run('console.log("hello world")');
    expect(stdout.toString("utf8")).toEqual("hello world\n");
  });

  test("it gets a correct specifer", async () => {
    const { stdout } = run("console.log(import.meta.path)");
    expect(stdout.toString("utf8")).toEndWith(sep + "[stdin]\n");
  });

  test("it can require", async () => {
    const { stdout } = run(`
        const process = require("node:process");
        console.log(process.platform);
      `);
    expect(stdout.toString("utf8")).toEqual(process.platform + "\n");
  });

  test("it can import", async () => {
    const { stdout } = run(`
        import * as process from "node:process";
        console.log(process.platform);
      `);
    expect(stdout.toString("utf8")).toEqual(process.platform + "\n");
  });
}

describe("bun run - < file-path.js", () => {
  function run(code: string) {
    const file = join(tmpdir(), "bun-run-eval-test.js");
    require("fs").writeFileSync(file, code);
    try {
      let result;
      if (process.platform === "win32") {
        result = Bun.spawnSync(["powershell", "-c", `Get-Content ${file} | ${bunExe()} run -`], {
          env: bunEnv,
          stderr: "inherit",
        });
      } else {
        result = Bun.spawnSync(["bash", "-c", `${bunExe()} run - < ${file}`], {
          env: bunEnv,
          stderr: "inherit",
        });
      }

      console.log(result);
      if (!result.success) {
        queueMicrotask(() => {
          throw new Error("bun run - < file-path.js failed");
        });
      }

      return result;
    } finally {
      try {
        require("fs").unlinkSync(file);
      } catch (e) {}
    }
  }

  group(run);
});

describe("echo | bun run -", () => {
  function run(code: string) {
    const result = Bun.spawnSync([bunExe(), "run", "-"], {
      env: bunEnv,
      stdin: Buffer.from(code),
      stderr: "inherit",
    });
    if (!result.success) {
      queueMicrotask(() => {
        throw new Error("bun run - failed");
      });
    }

    return result;
  }

  group(run);
});
