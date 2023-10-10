/// <reference types="../../../../packages/bun-types" />
import fs from "fs";
import path from "path";

const cwd = import.meta.dir;

function validate(packageName: string, version: string, realPackageName?: string) {
  process.stdout.write(`checking ${packageName} for ${realPackageName ? `${realPackageName}:${version}` : version}`);
  const pkg = JSON.parse(fs.readFileSync(path.join(cwd, packageName, "package.json"), "utf8"));
  if (pkg.version !== version) {
    process.stdout.write("... ❌ got " + pkg.version + "\n");
  } else {
    if (realPackageName && realPackageName != pkg.name) {
      process.stdout.write("... ❌ name was " + pkg.name + "\n");
    } else {
      process.stdout.write("... ✅\n");
    }
  }
}

function mustExist(filePath: string) {
  if (!fs.existsSync(filePath)) {
    console.log(`file ${filePath} ❌ should exist`);
  } else {
    console.log(`file ${filePath} ✅ exists`);
  }
}

function mustNotExist(filePath: string) {
  if (!fs.existsSync(filePath)) {
    console.log(`file ${filePath} ✅ does not exist`);
  } else {
    console.log(`file ${filePath} ❌ should not exist`);
  }
}

// bun-types
validate("node_modules/bun-types", "1.0.0");
mustExist("node_modules/bun-types/isfake.txt");
validate("node_modules/bun-types/node_modules/bun-types", "1.0.4");

// svelte
validate("node_modules/svelte", "4.1.2");
validate("packages/second/node_modules/svelte", "4.1.0");
validate("packages/with-postinstall/node_modules/svelte", "3.50.0");
validate("packages/body-parser/node_modules/svelte", "0.2.0", "public-install-test");
validate("node_modules/express", "1.0.0", "svelte");

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
validate("node_modules/body-parser", "1.13.3");
mustExist("node_modules/body-parser/isfake.txt");

validate("node_modules/not-body-parser", "1.13.3", "body-parser");
mustExist("node_modules/not-body-parser/isfake.txt");

validate("packages/second/node_modules/connect", "1.13.3", "body-parser");
mustExist("packages/second/node_modules/connect/isfake.txt");

validate("packages/second/node_modules/body-parser", "3.21.2", "express");
mustNotExist("packages/second/node_modules/body-parser/isfake.txt");

validate("packages/second/node_modules/body-parser/node_modules/body-parser", "1.13.3", "body-parser");
mustNotExist("packages/second/node_modules/body-parser/node_modules/body-parser/isfake.txt");

// connect
mustNotExist("node_modules/connect");
validate("packages/second/node_modules/body-parser/node_modules/connect", "2.30.2", "connect");

// sharp
validate("node_modules/sharp", "0.32.6");
