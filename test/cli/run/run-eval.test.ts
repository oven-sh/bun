import { describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { tmpdir } from "os";
import { join } from "path";

describe("bun -e", () => {
  test("it works", async () => {
    let { stdout } = Bun.spawnSync({
      cmd: [bunExe(), "-e", 'console.log("hello world")'],
      env: bunEnv,
    });
    expect(stdout.toString("utf8")).toEqual("hello world\n");
  });

  test("import, tsx, require in esm, import.meta", async () => {
    const ref = await import("react");
    let { stdout } = Bun.spawnSync({
      cmd: [
        bunExe(),
        "-e",
        'import {version} from "react"; console.log(JSON.stringify({version,file:import.meta.path,require:require("react").version})); console.log(<hello>world</hello>);',
      ],
      env: bunEnv,
    });
    const json = {
      version: ref.version,
      file: join(process.cwd(), "[eval]"),
      require: ref.version,
    };
    expect(stdout.toString("utf8")).toEqual(JSON.stringify(json) + "\n<hello>world</hello>\n");
  });

  test("error has source map info 1", async () => {
    let { stdout, stderr } = Bun.spawnSync({
      cmd: [bunExe(), "-e", '(throw new Error("hi" as 2))'],
      env: bunEnv,
    });
    expect(stderr.toString("utf8")).toInclude('"hi" as 2');
    expect(stderr.toString("utf8")).toInclude("Unexpected throw");
  });
});
