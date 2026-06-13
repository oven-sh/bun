/**
 * Codegen contract tests for the $native()/$newNativeFunction() JS-to-native
 * binding macros (src/codegen/generate-js2native.ts + replacements.ts).
 *
 * These exercise the build-time resolution logic only: a key names the
 * implementing `.rs` file, is validated against the source tree, and produces
 * the JS2Native__* symbol shared by the generated C++ extern and the Rust
 * thunk. The `.zig` porting references are not consulted.
 * https://github.com/oven-sh/bun/issues/32210
 */
import { expect, test } from "bun:test";

import { sliceSourceCode } from "../../src/codegen/builtin-parser.ts";
import {
  getJS2NativeCPP,
  getJS2NativeDTS,
  getJS2NativeRust,
  registerNativeCall,
} from "../../src/codegen/generate-js2native.ts";

test("$native() lowers to a lazy intrinsic and resolves its .rs key", () => {
  const out = sliceSourceCode(`{ const binding = $native("mysql.rs", "createBinding"); }`, true);
  expect(out.result).toContain("__intrinsic__lazy(");
});

test("$newNativeFunction() lowers to a lazy intrinsic", () => {
  const out = sliceSourceCode(`{ const fn = $newNativeFunction("node_util_binding.rs", "parseEnv", 1); }`, true);
  expect(out.result).toContain("__intrinsic__lazy(");
});

test("keys must name a real .rs file", () => {
  expect(() => registerNativeCall("native", "not_a_real_file.rs", "foo", null)).toThrow(
    /Could not find file not_a_real_file\.rs/,
  );
});

test(".zig keys are rejected", () => {
  expect(() => registerNativeCall("native", "mysql.zig", "createBinding", null)).toThrow(/\.rs extension/);
});

test("ambiguous basenames are rejected instead of first-match resolved", () => {
  // lib.rs exists in nearly every crate under src/.
  expect(() => registerNativeCall("native", "lib.rs", "foo", null)).toThrow(/Ambiguous filename "lib\.rs"/);
});

test("C++ externs and Rust thunks share JS2Native__ symbols derived from the .rs path", () => {
  registerNativeCall("native", "mysql.rs", "createBinding", null);
  registerNativeCall("native", "node_util_binding.rs", "parseEnv", 1);
  const cpp = getJS2NativeCPP();
  const rust = getJS2NativeRust();
  // Direct call: src/sql_jsc/mysql.rs + createBinding.
  expect(cpp).toContain("JS2Native___src_sql_jsc_mysql_createBinding_workaround");
  expect(rust).toContain("JS2Native___src_sql_jsc_mysql_createBinding_workaround");
  // Wrapped host function: src/runtime/node/node_util_binding.rs + parseEnv.
  expect(cpp).toContain("JS2Native___src_runtime_node_node_util_binding_parseEnv");
  expect(rust).toContain("JS2Native___src_runtime_node_node_util_binding_parseEnv");
  expect(cpp).not.toContain("JS2Zig");
  expect(rust).not.toContain("JS2Zig");
});

test("Rust thunks call the crate path derived from the .rs file", () => {
  registerNativeCall("native", "mysql.rs", "createBinding", null);
  registerNativeCall("native", "node_util_binding.rs", "parseEnv", 1);
  const rust = getJS2NativeRust();
  // src/runtime/node/node_util_binding.rs -> bun_runtime's own module tree.
  expect(rust).toContain("crate::node::node_util_binding::parse_env");
  // src/sql_jsc/mysql.rs lives outside bun_runtime -> flat dispatch re-export.
  expect(rust).toContain("crate::dispatch::js2native::sql_jsc_mysql_create_binding");
});

test("generated d.ts types the keys as .rs filenames", () => {
  const dts = getJS2NativeDTS();
  expect(dts).toContain("declare type NativeFilenameRust = ");
  expect(dts).toContain('"mysql.rs"');
  expect(dts).toContain('"sql_jsc/mysql.rs"');
  expect(dts).not.toContain("NativeFilenameZig");
});
