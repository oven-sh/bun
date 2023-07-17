import { expect, test } from "bun:test";
import { mkdirSync, realpathSync } from "fs";
import { bunEnv, bunExe, bunTempDirWithFiles, bunRunAsScript } from "harness";
import { tmpdir } from "os";
import { join } from "path";

test.todo("running a commonjs module works", async () => {
  const dir = join(realpathSync(tmpdir()), "bun-run-test1");
  mkdirSync(dir, { recursive: true });
  await Bun.write(join(dir, "index1.js"), "module.exports = 1; console.log('hello world');");
  let { stdout } = Bun.spawnSync({
    cmd: [bunExe(), join(dir, "index1.js")],
    cwd: dir,
    env: bunEnv,
  });
  expect(stdout.toString("utf8")).toEqual("hello world\n");
});

test("not running with export default class", async () => {
  const dir = join(realpathSync(tmpdir()), "bun-run-test2");
  mkdirSync(dir, { recursive: true });
  await Bun.write(
    join(dir, "index1.js"),
    `// @bun
class Foo {
  constructor() {
    console.log('hello world');
  }
};
Foo[Symbol.for("CommonJS")] = true;
export default Foo
`,
  );
  let { stdout } = Bun.spawnSync({
    cmd: [bunExe(), join(dir, "index1.js")],
    cwd: dir,
    env: bunEnv,
  });
  expect(stdout.toString("utf8")).toEqual("");
});

test("npm_package_config", () => {
   const dir = tempDirWithFiles("npmpkgcfg", {
      "package.json": JSON.stringify({
      "name": "bun_npm_package_config",
      "config": {
        "a": "echo 'b'"
      },
      "scripts": {
        "c": "$npm_package_config_a",
      }
    })
  });
  
  const { stdout } = bunRunAsScript(dir, "c");
  expect(stdout).toBe("b");
});
