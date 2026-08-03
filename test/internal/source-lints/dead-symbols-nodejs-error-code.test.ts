// Guards against reintroduction of symbols removed as dead code from
// src/runtime/node (nodejs_error_code.rs, IteratorError, VectorArrayBuffer::to_js)
// and src/resolver/fs.rs. Each entry was verified to have zero callers across
// src/ and build/debug/codegen/ before deletion.
//
// This is a source-tree lint: it reads files from src/ and does not touch the
// built binary.

import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

function src(p: string): string {
  return readFileSync(path.join(repoRoot, p), "utf8");
}

test("src/runtime/node/nodejs_error_code.rs stays deleted", () => {
  // 1113-line enum of Node `ERR_*` codes whose only consumer was
  // `node_os.rs` producing the string literal `"ERR_SYSTEM_ERROR"`.
  expect(existsSync(path.join(repoRoot, "src/runtime/node/nodejs_error_code.rs"))).toBe(false);
  expect(src("src/runtime/node.rs")).not.toMatch(/\bnodejs_error_code\b/);
  expect(src("src/runtime/node/node_os.rs")).not.toMatch(/crate::node::ErrorCode/);
});

test("dead Rust symbols in runtime/node + resolver do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/runtime/node/dir_iterator.rs", /\benum IteratorError\b/],
    ["src/runtime/error.rs", /\bDirIterator\b/],
    ["src/runtime/node/types.rs", /impl VectorArrayBuffer \{\n    pub fn to_js\(/],
    ["src/resolver/fs.rs", /pub fn statBatch\(fs: \*FileSystemEntry/],
  ];
  const resurrected = checks
    .filter(([file, re]) => re.test(src(file)))
    .map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});
