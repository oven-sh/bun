import { test, expect } from "bun:test";
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

test("inline /* */ comments in function parameter lists survive the runtime transpiler", async () => {
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
`,
    "main.cjs": `
const m = require("./mod.cjs");
console.log(JSON.stringify({
  anonExpr: m.anonExpr.toString(),
  decl: m.decl.toString(),
  method: m.obj.method.toString(),
  karma: m.karma.toString(),
  lineComment: m.lineComment.toString(),
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
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);
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

  expect(exitCode).toBe(0);
});
