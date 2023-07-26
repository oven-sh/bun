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
<<<<<<< HEAD
  const vals = {
    "port": 8000,
    "password": "hello world",
    "password2": " hello world ",
<<<<<<< HEAD
=======
  const vals = {
    "port": 8000,
    "password": "hello world",
>>>>>>> 487a471a (More fixes)
=======
>>>>>>> a57fc15f (Little fixes)
    "isDev": true,
    "isProd": false,
    "piNum": 3.14,
    "emptyStr": "",
<<<<<<< HEAD
<<<<<<< HEAD
<<<<<<< HEAD
    "emptyStr2": " ",
=======
  //  "emptyStr2": " ", TODO: fix this being "" in bun
  /*  "foo": {
      "bar": "baz"
    }, TODO: Support objects */
>>>>>>> 487a471a (More fixes)
=======
>>>>>>> 40553a28 (Add object support)
=======
    "emptyStr2": " ",
>>>>>>> a57fc15f (Little fixes)
    "why": 0,
    "none": null,
    "emoji": "🍕"
  };
<<<<<<< HEAD

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
<<<<<<< HEAD

    expect(jsVl).toBeTypeOf("string");

    if (val === false || val === null) {
      expect(jsVl).toEqual('""');
<<<<<<< HEAD
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
=======
>>>>>>> 487a471a (More fixes)

  const dir = tempDirWithFiles("npmpkgcfg", {
    "package.json": JSON.stringify({
      config: vals,
      "scripts": {
        "dev": bunExe() + " run index.js"
      }
    }),
    "index.js": "console.log(JSON.stringify(process.env))"
  });

<<<<<<< HEAD
  const { stdout: stdout2 } = bunRunAsScript(dir2, "c");
  expect(stdout2.toString()).toBe("Hello, Bun!");
<<<<<<< HEAD
>>>>>>> c750eb5d (Impl. npm_package_config)
=======
=======
  const { stdout } = bunRunAsScript(dir, "dev");
  const jsStd = JSON.parse(stdout.toString())
>>>>>>> 487a471a (More fixes)

  for (const [key, val] of Object.entries(vals)) {
    const jsVl = jsStd[`npm_package_config_${key}`];
    console.log(key, jsVl, val)
=======
>>>>>>> 40553a28 (Add object support)

<<<<<<< HEAD
  const { stdout: stdout3 } = bunRunAsScript(dir3, "c");
  expect(JSON.parse(stdout3)).toEqual({ port: '8080', somebool: 'true' });
>>>>>>> adf1d592 (Add support for numbers + booleans)
=======
    expect(jsVl).toBeTypeOf("string");

    if (val === false || val === null) {
      expect(jsVl).toEqual("");
=======
>>>>>>> a57fc15f (Little fixes)
      continue;
    }

    if (jsVl == '""' && key === "emptyStr") {
      continue;
    }
    
    expect(jsVl).toEqual(val.toString());
  }
<<<<<<< HEAD
>>>>>>> 487a471a (More fixes)
=======

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
>>>>>>> 40553a28 (Add object support)
});
<<<<<<< HEAD
=======
>>>>>>> c2a77cf7 (Rewrite built-in modules to use CommonJS over ESM (#3814))
=======
>>>>>>> 6ac18215 (oops)
