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
<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> 6ac18215 (oops)

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
<<<<<<< HEAD
  const vals = {
    "port": 8000,
    "password": "hello world",
    "password2": " hello world ",
    "isDev": true,
    "isProd": false,
    "piNum": 3.14,
    "emptyStr": "",
    "emptyStr2": " ",
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

    expect(jsVl).toBeTypeOf("string");

    if (val === false || val === null) {
      expect(jsVl).toEqual('""');
      continue;
    }

    if (jsVl == '""' && key === "emptyStr") {
      continue;
    }
    
    expect(jsVl).toEqual(val.toString());
  }

  // Now deep objects
  const deepDir = tempDirWithFiles("npmpkgcfg", {
    "package.json": JSON.stringify({
      config: {
        "foo": {
          "bar": "baz",
          "buzz": {
            "fizz": " fuzz",
            "dave": "🕶️",
            "something": 1
          }
        }
      },
      "scripts": {
        "dev": bunExe() + " run index.js"
      }
    }),
    "index.js": "console.log(JSON.stringify(process.env))"
  });

  const { stdout: deepStdout } = bunRunAsScript(deepDir, "dev");
  const deepJsStd = JSON.parse(deepStdout.toString())

  expect(deepJsStd.npm_package_config_foo_bar).toEqual("baz");
  expect(deepJsStd.npm_package_config_foo_buzz_fizz).toEqual(" fuzz");
  expect(deepJsStd.npm_package_config_foo_buzz_dave).toEqual("🕶️");
  expect(deepJsStd.npm_package_config_foo_buzz_something).toEqual("1");
=======
   const dir = tempDirWithFiles("npmpkgcfg", {
      "package.json": JSON.stringify({
        "name": "bun_npm_package_config",
        "config": {
          "a": "echo Hello, Bun!"
        },
        "scripts": {
          "c": "$npm_package_config_a",
        }
      })
  });
  
  const { stdout } = bunRunAsScript(dir, "c");
  expect(stdout.toString()).toBe("Hello, Bun!");

  // test multiple config values
  const dir2 = tempDirWithFiles("npmpkgcfg2", {
    "package.json": JSON.stringify({
      "name": "bun_npm_package_config",
      "config": {
        "a": "Bun!",
        "b": "Hello,"
      },
      "scripts": {
        "c": "echo $npm_package_config_b $npm_package_config_a",
      }
    })
  });

  const { stdout: stdout2 } = bunRunAsScript(dir2, "c");
  expect(stdout2.toString()).toBe("Hello, Bun!");
<<<<<<< HEAD
>>>>>>> c750eb5d (Impl. npm_package_config)
=======

  // test env in file
  const dir3 = tempDirWithFiles("npmpkgcfg3", {
      "package.json": JSON.stringify({
        "name": "bun_npm_package_config",
        "config": {
          "port": 8080,
          "somebool": true
        },
        "scripts": {
          "c": bunExe() + " run index.js",
        }
      }),
      "index.js": `
        console.log(JSON.stringify({
          port: process.env.npm_package_config_port,
          somebool: process.env.npm_package_config_somebool
        }))
      `
  });

  const { stdout: stdout3 } = bunRunAsScript(dir3, "c");
  expect(JSON.parse(stdout3)).toEqual({ port: '8080', somebool: 'true' });
>>>>>>> adf1d592 (Add support for numbers + booleans)
});
<<<<<<< HEAD
=======
>>>>>>> c2a77cf7 (Rewrite built-in modules to use CommonJS over ESM (#3814))
=======
>>>>>>> 6ac18215 (oops)
