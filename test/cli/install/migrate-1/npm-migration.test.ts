import fs from "fs";
import path from "path";
import { test, expect, describe, beforeAll } from "bun:test";
import { bunEnv, bunExe } from "harness";

const cwd = import.meta.dir;

function validate(packageName: string, version: string, realPackageName?: string) {
  test(`${packageName} is ${realPackageName ? `${realPackageName}@${version}` : version}`, () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, packageName, "package.json"), "utf8"));
    expect(pkg.version).toBe(version);
    if (realPackageName) {
      expect(pkg.name).toBe(realPackageName);
    }
  });
}

function mustExist(filePath: string) {
  test(`${filePath} exists`, () => {
    if (!fs.existsSync(path.join(cwd, filePath))) {
      throw new Error(`File ${filePath} was not found`);
    }
  });
}

function mustNotExist(filePath: string) {
  test(`${filePath} does not exist`, () => {
    if (fs.existsSync(path.join(cwd, filePath))) {
      throw new Error(`File ${filePath} was found`);
    }
  });
}

beforeAll(() => {
  fs.rmSync("bun.lockb", { recursive: true, force: true });
  fs.rmSync("node_modules", { recursive: true, force: true });
  fs.rmSync("packages/body-parser/node_modules", { recursive: true, force: true });
  fs.rmSync("packages/lol-package/node_modules", { recursive: true, force: true });
  fs.rmSync("packages/second/node_modules", { recursive: true, force: true });
  fs.rmSync("packages/with-postinstall/node_modules", { recursive: true, force: true });
  fs.rmSync("packages/with-postinstall/postinstall.txt", { recursive: true, force: true });

  Bun.spawnSync([bunExe(), "install"], {
    env: bunEnv,
  });
});

// bun-types
validate("node_modules/bun-types", "1.0.0");
mustExist("node_modules/bun-types/isfake.txt");
validate("node_modules/bun-types/node_modules/bun-types", "1.0.0");
mustNotExist("node_modules/bun-types/node_modules/bun-types/isfake.txt");

// svelte
validate("node_modules/svelte", "4.1.2");
validate("packages/second/node_modules/svelte", "4.1.0");
validate("packages/with-postinstall/node_modules/svelte", "3.50.0");
validate("packages/body-parser/node_modules/svelte", "0.2.0", "public-install-test");
// NOTE: bun hoists this dependency higher than npm
// npm places this in node_modules/express
validate("packages/second/node_modules/express", "1.0.0", "svelte");

// install test
validate("node_modules/install-test", "0.3.0", "publicinstalltest");
mustExist("node_modules/install-test/src/index.js");
validate("node_modules/install-test1", "0.2.0", "install-test");
mustExist("node_modules/install-test1/index.js");
validate("node_modules/public-install-test", "0.2.0", "public-install-test");
mustExist("node_modules/public-install-test/index.js");

// hello
validate("node_modules/hello", "0.3.2");
mustExist("node_modules/hello/version.txt");
mustNotExist("packages/second/node_modules/hello/version.txt");

// body parser
validate("node_modules/body-parser", "200.0.0");
// NOTE: bun hoists this dependency higher than npm
// npm places this in node_modules/not-body-parser
validate("packages/second/node_modules/not-body-parser", "200.0.0", "body-parser");
validate("packages/second/node_modules/connect", "200.0.0", "body-parser");
validate("packages/second/node_modules/body-parser", "3.21.2", "express");
// NOTE: bun does not hoist this properly, but it is extremely unlikely to be a real use case
// validate("packages/second/node_modules/body-parser/node_modules/body-parser", "1.13.3", "body-parser");

// connect
mustNotExist("node_modules/connect");
validate("packages/second/node_modules/body-parser/node_modules/connect", "2.30.2", "connect");

// sharp
validate("node_modules/sharp", "0.32.6");

// iconv-lite
mustNotExist("packages/second/node_modules/body-parser/node_modules/body-parser/node_modules/iconv-lite");
mustNotExist("packages/second/node_modules/body-parser/node_modules/iconv-lite");
mustNotExist("packages/second/node_modules/iconv-lite");
mustNotExist("node_modules/iconv-lite");
