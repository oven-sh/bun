import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/13451
//
// Karma's `di` package (and AngularJS $injector) parse Function.prototype.toString()
// to extract DI tokens from /* comment */-annotated parameter names, e.g.
//
//   exports.create = function (/* config */ config, /* config.proxies */ proxies) { ... }
//
// Bun's runtime transpiler was discarding those comments, so `di` saw `proxies`
// instead of `config.proxies` and failed with "No provider for "proxies"!".

const FN_ARGS = /^function\s*[^\(]*\(\s*([^\)]*)\)/m;
const FN_ARG = /\/\*([^\*]*)\*\//m;

function diParse(src: string): string[] {
  const match = src.match(FN_ARGS);
  if (!match || !match[1]) return [];
  return match[1].split(",").map(arg => {
    const m = arg.match(FN_ARG);
    return m ? m[1].trim() : arg.trim();
  });
}

test.concurrent("inline /* */ comments in function parameter lists survive the runtime transpiler", async () => {
  using dir = tempDir("issue-13451", {
    "mod.cjs": `
exports.anonExpr = function (/* a */ x, /* b.c */ y, /* d */ z) {
  return [x, y, z];
};

function decl(/* one */ p, /* two */ q) {
  return [p, q];
}
exports.decl = decl;

exports.obj = {
  method(/* inner */ v) {
    return v;
  },
};

exports.karma = function (/* config */ config, /* config.proxies */ proxies, /* emitter */ emitter) {
  return [config, proxies, emitter];
};

exports.lineComment = function (
  // token
  value
) {
  return value;
};

exports.noMigrateDefault = function (a = /* x */ 1, b) {
  return [a, b];
};

exports.noMigrateTrailing = function (a /* trail */, b) {
  return [a, b];
};

exports.noLeakIntoBody = function (a = () => { return 1 /* mid */ + 2; }, b) {
  return [a, b];
};
`,
    "main.cjs": `
const m = require("./mod.cjs");
console.log(JSON.stringify({
  anonExpr: m.anonExpr.toString(),
  decl: m.decl.toString(),
  method: m.obj.method.toString(),
  karma: m.karma.toString(),
  lineComment: m.lineComment.toString(),
  noMigrateDefault: m.noMigrateDefault.toString(),
  noMigrateTrailing: m.noMigrateTrailing.toString(),
  noLeakIntoBody: m.noLeakIntoBody.toString(),
}));
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");

  const results = JSON.parse(stdout);

  // anonymous function expression
  expect(results.anonExpr).toContain("/* a */");
  expect(results.anonExpr).toContain("/* b.c */");
  expect(results.anonExpr).toContain("/* d */");
  expect(diParse(results.anonExpr)).toEqual(["a", "b.c", "d"]);

  // named function declaration
  expect(results.decl).toContain("/* one */");
  expect(results.decl).toContain("/* two */");
  expect(diParse(results.decl)).toEqual(["one", "two"]);

  // object method shorthand
  expect(results.method).toContain("/* inner */");

  // karma's exact pattern from middleware/proxy.js
  expect(results.karma).toContain("/* config */");
  expect(results.karma).toContain("/* config.proxies */");
  expect(results.karma).toContain("/* emitter */");
  expect(diParse(results.karma)).toEqual(["config", "config.proxies", "emitter"]);

  // line comment converted to block (otherwise it would swallow the arg list)
  expect(results.lineComment).not.toMatch(/\/\/[^\n]*\)/);
  expect(results.lineComment).toContain("token");

  // Comments inside a default value / after a binding must not migrate to the
  // next argument (that would change the DI token), nor surface as statements
  // inside a nested body.
  expect(results.noMigrateDefault).not.toContain("/* x */");
  expect(diParse(results.noMigrateDefault)).toEqual(["a = 1", "b"]);
  expect(results.noMigrateTrailing).not.toContain("/* trail */");
  expect(diParse(results.noMigrateTrailing)).toEqual(["a", "b"]);
  expect(results.noLeakIntoBody).not.toContain("/* mid */");

  expect(exitCode).toBe(0);
});

test.concurrent("comments inside erased TS this-params/decorators are not relocated onto real args", async () => {
  using dir = tempDir("issue-13451-ts", {
    "in.ts": `
export function f1(this: /* Self */ number, x: number) { return x; }
export function f2(/* ctx */ this: number, x: number) { return x; }
declare const dec: any;
export class C {
  constructor(@dec(/* opts */) x: number) {}
}
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--target=bun", "in.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).not.toContain("/* Self */");
  expect(stdout).not.toContain("/* ctx */");
  expect(stdout).not.toContain("/* opts */");
  expect(exitCode).toBe(0);
});

test.concurrent("legal comments in parameter lists survive minification", async () => {
  using dir = tempDir("issue-13451-legal", {
    "in.js": `
export const f = function(/*! @license MIT */ x) { return x; };
export const g = function(/*! @preserve */) { return 1; };
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--minify", "in.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toContain("/*! @license MIT */");
  expect(stdout).toContain("/*! @preserve */");
  expect(exitCode).toBe(0);
});
