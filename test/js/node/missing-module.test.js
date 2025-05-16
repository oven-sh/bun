import assert from "assert";
import { test } from "bun:test";

test("not implemented yet module throws an error", () => {
  var missingModule = "node:missing";
  var missingBun = "bun:missing";
  var missingFile = "./filethatdoesntexist";
  var missingPackage = "package-that-doesnt-exist";

  assert.throws(() => require(missingModule), {
    message: "No such built-in module: node:missing",
    code: "ERR_UNKNOWN_BUILTIN_MODULE",
  });
  assert.throws(() => require.resolve(missingModule), {
    message: /Cannot find package 'node:missing' from/,
    code: "MODULE_NOT_FOUND",
  });
  assert.rejects(() => import(missingModule), {
    message: "No such built-in module: node:missing",
    code: "ERR_UNKNOWN_BUILTIN_MODULE",
  });

  assert.throws(() => require(missingBun), {
    message: /^Cannot find package 'bun:missing' from/,
    code: "MODULE_NOT_FOUND",
  });
  assert.throws(() => require.resolve(missingBun), {
    message: /^Cannot find package 'bun:missing' from/,
    code: "MODULE_NOT_FOUND",
  });
  assert.rejects(() => import(missingBun), {
    message: /^Cannot find package 'bun:missing' from/,
    code: "ERR_MODULE_NOT_FOUND",
  });

  assert.throws(() => require(missingFile), {
    message: /^Cannot find module '\.\/filethatdoesntexist'/,
    code: "MODULE_NOT_FOUND",
  });
  assert.throws(() => require.resolve(missingFile), {
    message: /^Cannot find module '\.\/filethatdoesntexist'/,
    code: "MODULE_NOT_FOUND",
  });
  assert.rejects(() => import(missingFile), {
    message: /^Cannot find module '\.\/filethatdoesntexist'/,
    code: "ERR_MODULE_NOT_FOUND",
  });

  assert.throws(() => require(missingPackage), {
    message: /^Cannot find package 'package-that-doesnt-exist'/,
    code: "MODULE_NOT_FOUND",
  });
  assert.throws(() => require.resolve(missingPackage), {
    message: /^Cannot find package 'package-that-doesnt-exist'/,
    code: "MODULE_NOT_FOUND",
  });
  assert.rejects(() => import(missingPackage), {
    message: /^Cannot find package 'package-that-doesnt-exist'/,
    code: "ERR_MODULE_NOT_FOUND",
  });
});
