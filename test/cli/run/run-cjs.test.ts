import { expect, test } from "bun:test";
import { mkdirSync, realpathSync } from "fs";
import { bunEnv, bunExe, tempDirWithFiles, bunRunAsScript } from "harness";
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
  const vals = {
    "port": 8000,
    "password": "hello world",
    "isDev": true,
    "isProd": false,
    "piNum": 3.14,
    "emptyStr": "",
  //  "emptyStr2": " ", TODO: fix this being "" in bun
  /*  "foo": {
      "bar": "baz"
    }, TODO: Support objects */
    "why": 0,
    "none": null,
    "emoji": "🍕"
  };

  const dir = tempDirWithFiles("npmpkgcfg", {
    "package.json": JSON.stringify({
      config: vals,
      "scripts": {
        "dev": bunExe() + " run index.js"
      }
    }),
    "index.js": "console.log(JSON.stringify(process.env))"
  });

  const { stdout } = bunRunAsScript(dir, "dev");
  const jsStd = JSON.parse(stdout.toString())

  for (const [key, val] of Object.entries(vals)) {
    const jsVl = jsStd[`npm_package_config_${key}`];
    console.log(key, jsVl, val)

    expect(jsVl).toBeTypeOf("string");

    if (val === false || val === null) {
      expect(jsVl).toEqual("");
      continue;
    }

    expect(jsVl).toEqual(String(val));
  }
});
