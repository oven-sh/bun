import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

test("CommonJS module.exports function should be directly callable (#4506)", async () => {
  using dir = tempDir("test-cjs-function", {
    "package.json": JSON.stringify({ name: "test-pkg" }),
    "index.js": `
module.exports = function isNatural(value) {
  return Number.isInteger(value) && value >= 0;
};

module.exports.isPositive = function(value) {
  return Number.isInteger(value) && value > 0;
};
`,
    "test.js": `
const isNatural = require('./index.js');

// Should be directly callable
console.log(typeof isNatural === 'function' ? 'PASS: is function' : 'FAIL: not function');
console.log(isNatural(5) === true ? 'PASS: isNatural(5)' : 'FAIL: isNatural(5)');
console.log(isNatural(-1) === false ? 'PASS: isNatural(-1)' : 'FAIL: isNatural(-1)');

// Named export should also work
console.log(typeof isNatural.isPositive === 'function' ? 'PASS: has isPositive' : 'FAIL: no isPositive');
console.log(isNatural.isPositive(1) === true ? 'PASS: isPositive(1)' : 'FAIL: isPositive(1)');
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");
  expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(`
"PASS: is function
PASS: isNatural(5)
PASS: isNatural(-1)
PASS: has isPositive
PASS: isPositive(1)"
`);
});

test("CommonJS exports object should be directly accessible", async () => {
  using dir = tempDir("test-cjs-object", {
    "package.json": JSON.stringify({ name: "test-pkg" }),
    "module.js": `
exports.foo = "bar";
exports.baz = 42;
exports.func = function() { return "hello"; };
`,
    "test.js": `
const mod = require('./module.js');

console.log(mod.foo === "bar" ? 'PASS: foo' : 'FAIL: foo');
console.log(mod.baz === 42 ? 'PASS: baz' : 'FAIL: baz');
console.log(typeof mod.func === 'function' ? 'PASS: func is function' : 'FAIL: func not function');
console.log(mod.func() === "hello" ? 'PASS: func()' : 'FAIL: func()');

// Should not have __esModule added
console.log(mod.__esModule === undefined ? 'PASS: no __esModule' : 'FAIL: has __esModule');
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");
  expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(`
"PASS: foo
PASS: baz
PASS: func is function
PASS: func()
PASS: no __esModule"
`);
});

test("ESM import of CommonJS default export", async () => {
  using dir = tempDir("test-esm-cjs-default", {
    "package.json": JSON.stringify({ name: "test-pkg", type: "module" }),
    "cjs-module.cjs": `
module.exports = function myFunction() {
  return "default export";
};

module.exports.namedExport = "named";
`,
    "test.mjs": `
import myFunction from './cjs-module.cjs';
import * as mod from './cjs-module.cjs';

// Default import should be the entire module.exports
console.log(typeof myFunction === 'function' ? 'PASS: default is function' : 'FAIL: default not function');
console.log(myFunction() === 'default export' ? 'PASS: default()' : 'FAIL: default()');

// Named export should be accessible on the default
console.log(myFunction.namedExport === 'named' ? 'PASS: default.namedExport' : 'FAIL: default.namedExport');

// Star import should have default pointing to module.exports
console.log(typeof mod.default === 'function' ? 'PASS: mod.default is function' : 'FAIL: mod.default not function');
console.log(mod.default() === 'default export' ? 'PASS: mod.default()' : 'FAIL: mod.default()');
console.log(mod.namedExport === 'named' ? 'PASS: mod.namedExport' : 'FAIL: mod.namedExport');
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");
  expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(`
"PASS: default is function
PASS: default()
PASS: default.namedExport
PASS: mod.default is function
PASS: mod.default()
PASS: mod.namedExport"
`);
});

test("ESM import of CommonJS with exports object", async () => {
  using dir = tempDir("test-esm-cjs-exports", {
    "package.json": JSON.stringify({ name: "test-pkg", type: "module" }),
    "cjs-module.cjs": `
exports.foo = "bar";
exports.baz = 42;
exports.func = function() { return "hello"; };
`,
    "test.mjs": `
import defaultExport from './cjs-module.cjs';
import * as mod from './cjs-module.cjs';

// Default import should be the entire exports object
console.log(typeof defaultExport === 'object' ? 'PASS: default is object' : 'FAIL: default not object');
console.log(defaultExport.foo === 'bar' ? 'PASS: default.foo' : 'FAIL: default.foo');
console.log(defaultExport.baz === 42 ? 'PASS: default.baz' : 'FAIL: default.baz');
console.log(typeof defaultExport.func === 'function' ? 'PASS: default.func' : 'FAIL: default.func');

// Star import should have the same properties plus default
console.log(mod.default === defaultExport ? 'PASS: mod.default === default' : 'FAIL: mod.default !== default');
console.log(mod.foo === 'bar' ? 'PASS: mod.foo' : 'FAIL: mod.foo');
console.log(mod.baz === 42 ? 'PASS: mod.baz' : 'FAIL: mod.baz');
console.log(typeof mod.func === 'function' ? 'PASS: mod.func' : 'FAIL: mod.func');
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");
  expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(`
"PASS: default is object
PASS: default.foo
PASS: default.baz
PASS: default.func
PASS: mod.default === default
PASS: mod.foo
PASS: mod.baz
PASS: mod.func"
`);
});

test("CommonJS module with __esModule should be treated normally", async () => {
  using dir = tempDir("test-esmodule-flag", {
    "package.json": JSON.stringify({ name: "test-pkg", type: "module" }),
    "cjs-with-flag.cjs": `
// This module manually sets __esModule, which should now be treated as a normal property
exports.__esModule = true;
exports.default = "explicit default";
exports.foo = "bar";
`,
    "test.mjs": `
import defaultExport from './cjs-with-flag.cjs';
import * as mod from './cjs-with-flag.cjs';

// With __esModule workaround removed, default import should be the entire exports object
// NOT the value of exports.default
console.log(typeof defaultExport === 'object' ? 'PASS: default is object' : 'FAIL: default not object');
console.log(defaultExport.default === 'explicit default' ? 'PASS: has .default property' : 'FAIL: no .default property');
console.log(defaultExport.foo === 'bar' ? 'PASS: has .foo property' : 'FAIL: no .foo property');
console.log(defaultExport.__esModule === true ? 'PASS: has .__esModule property' : 'FAIL: no .__esModule property');

// Star import verification
console.log(mod.default === defaultExport ? 'PASS: mod.default is exports object' : 'FAIL: mod.default not exports object');
console.log(mod.foo === 'bar' ? 'PASS: mod.foo' : 'FAIL: mod.foo');
console.log(mod.__esModule === true ? 'PASS: mod.__esModule' : 'FAIL: mod.__esModule');
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");
  expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(`
"PASS: default is object
PASS: has .default property
PASS: has .foo property
PASS: has .__esModule property
PASS: mod.default is exports object
PASS: mod.foo
PASS: mod.__esModule"
`);
});

test("Bundler should handle CommonJS correctly without __esModule", async () => {
  using dir = tempDir("test-bundler-cjs", {
    "package.json": JSON.stringify({ name: "test-pkg" }),
    "module.js": `
module.exports = function() { return "bundled"; };
module.exports.extra = "data";
`,
    "entry.js": `
const mod = require('./module.js');
console.log(typeof mod === 'function' ? 'PASS: is function' : 'FAIL: not function');
console.log(mod() === 'bundled' ? 'PASS: call result' : 'FAIL: call result');
console.log(mod.extra === 'data' ? 'PASS: extra property' : 'FAIL: extra property');
`,
  });

  // Build the bundle
  await using buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.js", "--outfile", "bundle.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [buildStdout, buildStderr, buildExitCode] = await Promise.all([
    buildProc.stdout.text(),
    buildProc.stderr.text(),
    buildProc.exited,
  ]);

  expect(buildExitCode).toBe(0);

  // Run the bundle
  await using runProc = Bun.spawn({
    cmd: [bunExe(), "bundle.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [runStdout, runStderr, runExitCode] = await Promise.all([
    runProc.stdout.text(),
    runProc.stderr.text(),
    runProc.exited,
  ]);

  expect(runExitCode).toBe(0);
  expect(runStderr).toBe("");
  expect(normalizeBunSnapshot(runStdout, dir)).toMatchInlineSnapshot(`
"PASS: is function
PASS: call result
PASS: extra property"
`);
});

test("Node.js compatibility - require() should return raw module.exports", async () => {
  using dir = tempDir("test-nodejs-compat", {
    "package.json": JSON.stringify({ name: "test-pkg" }),
    "cjs-array.js": `
// Module that exports an array directly
module.exports = [1, 2, 3];
`,
    "cjs-string.js": `
// Module that exports a string directly
module.exports = "hello world";
`,
    "cjs-number.js": `
// Module that exports a number directly
module.exports = 42;
`,
    "cjs-null.js": `
// Module that exports null
module.exports = null;
`,
    "test.js": `
const arr = require('./cjs-array.js');
const str = require('./cjs-string.js');
const num = require('./cjs-number.js');
const nil = require('./cjs-null.js');

// Arrays should work
console.log(Array.isArray(arr) ? 'PASS: array' : 'FAIL: not array');
console.log(arr.length === 3 ? 'PASS: array length' : 'FAIL: array length');

// Strings should work
console.log(typeof str === 'string' ? 'PASS: string' : 'FAIL: not string');
console.log(str === 'hello world' ? 'PASS: string value' : 'FAIL: string value');

// Numbers should work
console.log(typeof num === 'number' ? 'PASS: number' : 'FAIL: not number');
console.log(num === 42 ? 'PASS: number value' : 'FAIL: number value');

// Null should work
console.log(nil === null ? 'PASS: null' : 'FAIL: not null');
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");
  expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(`
"PASS: array
PASS: array length
PASS: string
PASS: string value
PASS: number
PASS: number value
PASS: null"
`);
});

test("CommonJS circular dependencies should work like Node.js", async () => {
  using dir = tempDir("test-circular", {
    "package.json": JSON.stringify({ name: "test-pkg" }),
    "a.js": `
console.log('a starting');
exports.done = false;
const b = require('./b.js');
console.log('in a, b.done = ' + b.done);
exports.done = true;
console.log('a done');
`,
    "b.js": `
console.log('b starting');
exports.done = false;
const a = require('./a.js');
console.log('in b, a.done = ' + a.done);
exports.done = true;
console.log('b done');
`,
    "main.js": `
console.log('main starting');
const a = require('./a.js');
const b = require('./b.js');
console.log('in main, a.done=' + a.done + ', b.done=' + b.done);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");
  expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(`
"main starting
a starting
b starting
in b, a.done = false
b done
in a, b.done = true
a done
in main, a.done=true, b.done=true"
`);
});

test("CommonJS module.exports reassignment", async () => {
  using dir = tempDir("test-reassign", {
    "package.json": JSON.stringify({ name: "test-pkg" }),
    "module.js": `
// Initially set exports properties
exports.foo = 'bar';
exports.num = 123;

// Then reassign module.exports completely
module.exports = function myFunc() {
  return 'replaced';
};

// Adding to exports after reassignment should have no effect
exports.ignored = 'this should not be visible';
`,
    "test.js": `
const mod = require('./module.js');

// Should be the function, not the original exports object
console.log(typeof mod === 'function' ? 'PASS: is function' : 'FAIL: not function');
console.log(mod() === 'replaced' ? 'PASS: function works' : 'FAIL: function broken');

// Original exports properties should not exist
console.log(mod.foo === undefined ? 'PASS: no foo' : 'FAIL: has foo');
console.log(mod.num === undefined ? 'PASS: no num' : 'FAIL: has num');
console.log(mod.ignored === undefined ? 'PASS: no ignored' : 'FAIL: has ignored');
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");
  expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(`
"PASS: is function
PASS: function works
PASS: no foo
PASS: no num
PASS: no ignored"
`);
});

test("ESM importing CommonJS with various exports patterns", async () => {
  using dir = tempDir("test-esm-cjs-patterns", {
    "package.json": JSON.stringify({ name: "test-pkg", type: "module" }),
    "cjs-class.cjs": `
class MyClass {
  constructor(name) {
    this.name = name;
  }
  greet() {
    return 'Hello ' + this.name;
  }
}
module.exports = MyClass;
`,
    "cjs-factory.cjs": `
module.exports = function createUser(name) {
  return { name: name, type: 'user' };
};
module.exports.VERSION = '1.0.0';
`,
    "test.mjs": `
import MyClass from './cjs-class.cjs';
import createUser from './cjs-factory.cjs';

// Class import should work
const instance = new MyClass('World');
console.log(typeof MyClass === 'function' ? 'PASS: class is function' : 'FAIL: class not function');
console.log(instance.greet() === 'Hello World' ? 'PASS: class works' : 'FAIL: class broken');

// Factory function with properties should work
console.log(typeof createUser === 'function' ? 'PASS: factory is function' : 'FAIL: factory not function');
const user = createUser('Alice');
console.log(user.name === 'Alice' ? 'PASS: factory works' : 'FAIL: factory broken');
console.log(createUser.VERSION === '1.0.0' ? 'PASS: factory property' : 'FAIL: no property');
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");
  expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(`
"PASS: class is function
PASS: class works
PASS: factory is function
PASS: factory works
PASS: factory property"
`);
});
