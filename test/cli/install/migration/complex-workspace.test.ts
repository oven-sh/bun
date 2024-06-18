import fs from "fs";
import path from "path";
import { test, expect, describe, beforeAll, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, tmpdirSync } from "harness";

let cwd = tmpdirSync();

function validate(packageName: string, version: string, realPackageName?: string) {
  test(`${packageName} is ${realPackageName ? `${realPackageName}@${version}` : version}`, () => {
    if (!cwd) throw new Error("install failed");
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, packageName, "package.json"), "utf8"));
    expect(pkg.version).toBe(version);
    if (realPackageName) {
      expect(pkg.name).toBe(realPackageName);
    }
  });
}

function mustExist(filePath: string) {
  test(`${filePath} exists`, () => {
    if (!cwd) throw new Error("install failed");
    if (!fs.existsSync(path.join(cwd, filePath))) {
      throw new Error(`File ${filePath} was not found`);
    }
  });
}

function mustNotExist(filePath: string) {
  test(`${filePath} does not exist`, () => {
    if (!cwd) throw new Error("install failed");
    if (fs.existsSync(path.join(cwd, filePath))) {
      throw new Error(`File ${filePath} was found`);
    }
  });
}

beforeAll(() => {
  setDefaultTimeout(1000 * 60 * 5);
  fs.cpSync(path.join(import.meta.dir, "complex-workspace"), cwd, { recursive: true });
});

test("the install succeeds", async () => {
  var subprocess = Bun.spawn([bunExe(), "reset.ts"], {
    env: bunEnv,
    cwd,
    stdio: ["inherit", "inherit", "inherit"],
  });
  await subprocess.exited;
  if (subprocess.exitCode != 0) {
    cwd = false as any;
    throw new Error("Failed to install");
  }

  subprocess = Bun.spawn([bunExe(), "install"], {
    env: bunEnv,
    cwd,
    stdio: ["inherit", "inherit", "inherit"],
  });

  await subprocess.exited;
  if (subprocess.exitCode != 0) {
    cwd = false as any;
    throw new Error("Failed to install");
  }
});

// bun-types
validate("node_modules/bun-types", "1.0.0");
mustExist("node_modules/bun-types/isfake.txt");
// NOTE: ???
// validate("node_modules/bun-types/node_modules/bun-types", "1.0.0");
mustNotExist("node_modules/bun-types/node_modules/bun-types/isfake.txt");

// svelte
validate("node_modules/svelte", "4.1.2");
validate("packages/second/node_modules/svelte", "4.1.0");
validate("packages/with-postinstall/node_modules/svelte", "3.50.0");
// validate("packages/body-parser/node_modules/svelte", "0.2.0", "public-install-test");
validate("node_modules/express", "1.0.0", "svelte");

// install test
// validate("node_modules/install-test", "0.3.0", "publicinstalltest");
// mustExist("node_modules/install-test/src/index.js");
validate("node_modules/install-test1", "0.2.0", "install-test");
mustExist("node_modules/install-test1/index.js");
// validate("node_modules/public-install-test", "0.2.0", "public-install-test");
// mustExist("node_modules/public-install-test/index.js");

// hello
validate("node_modules/hello", "0.3.2");
mustExist("node_modules/hello/version.txt");
mustNotExist("packages/second/node_modules/hello/version.txt");

// body parser
validate("node_modules/body-parser", "200.0.0");
validate("node_modules/not-body-parser", "200.0.0", "body-parser");
// NOTE: bun install doesnt properly handle npm aliased dependencies
// validate("packages/second/node_modules/connect", "200.0.0", "body-parser");
validate("packages/second/node_modules/body-parser", "3.21.2", "express");
// NOTE: bun does not hoist this properly, but it is extremely unlikely to be a real use case
// validate("packages/second/node_modules/body-parser/node_modules/body-parser", "1.13.3", "body-parser");

// connect
// mustNotExist("node_modules/connect");
// validate("packages/second/node_modules/body-parser/node_modules/connect", "2.30.2", "connect");

// sharp
validate("node_modules/sharp", "0.32.6");

// iconv-lite
mustNotExist("packages/second/node_modules/body-parser/node_modules/body-parser/node_modules/iconv-lite");
mustNotExist("packages/second/node_modules/body-parser/node_modules/iconv-lite");
mustNotExist("packages/second/node_modules/iconv-lite");
mustNotExist("node_modules/iconv-lite");
