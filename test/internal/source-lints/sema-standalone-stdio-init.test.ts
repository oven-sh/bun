import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// `bun-sema` (src/sema/standalone) is the type checker of `bun check` as a tool of its own. Cargo links it from Rust
// crates only, so it has a `main` of its own, and native.rs there stands in for the C and C++ symbols that `bun` has.
//
// A thread takes its `Output` streams from the process when it starts (`Source::configure_thread`), and only
// `bun_core::output::stdio::init()` sets them. In a dev build of the tool, a thread that starts before that call fails
// `debug_assert!(STDOUT_STREAM_SET)`, which aborts `cli`, `each` and `baselines`. A release build has no assertion and
// gives that thread `Fd::INVALID` for its streams. `bun`'s own `main` makes the call (src/runtime/bin_entry/mod.rs).
//
// No CI job links the tool or runs it: `cargo clippy` and `cargo check` stop before the link, and the tests run `bun`.
// So what a build of the tool needs for that call is checked in the source:
//   - `main` makes the call before anything else, which is before every thread and before `each` forks.
//   - native.rs has a stand-in for each C function that `stdio::init()` calls. Without one the tool does not link.
//
// To fix a failure: keep the call first in `main`, or add `#[unsafe(no_mangle)] extern "C" fn <name>() {}` to native.rs.

const src = path.resolve(import.meta.dir, "..", "..", "..", "src");
const read = (file: string) => readFileSync(path.join(src, file), "utf8");

describe("bun-sema", () => {
  test("`main` calls `bun_core::output::stdio::init()` before anything else", () => {
    const body = /\nfn main\(\) \{\n([\s\S]*?)\n\}\n/.exec(read("sema/standalone/main.rs"))?.[1] ?? "";
    const statements = body
      .split("\n")
      .map(line => line.trim())
      .filter(line => line !== "" && !line.startsWith("//"));
    expect(statements[0]).toBe("bun_core::output::stdio::init();");
  });

  test("native.rs stands in for each C function that `stdio::init()` calls", () => {
    const stdio = read("bun_core/output.rs").split("\npub mod stdio {\n")[1] ?? "";
    const externs = /\n    unsafe extern "C" \{\n([\s\S]*?)\n    \}\n/.exec(stdio)?.[1] ?? "";
    const init = /\n    pub fn init\(\) \{\n([\s\S]*?)\n    \}\n/.exec(stdio)?.[1] ?? "";
    const called = [...externs.matchAll(/\bfn (\w+)\(/g)]
      .map(found => found[1])
      .filter(name => init.includes(`${name}(`));
    // Not a check of nothing, should output.rs take another shape.
    expect(called).toContain("bun_initialize_process");

    const native = read("sema/standalone/native.rs");
    // The attribute, then the definition: without `no_mangle` the linker does not find the name.
    const standsIn = (name: string) =>
      new RegExp(
        `^ *#\\[unsafe\\(no_mangle\\)\\]\\n(?: *#\\[.*\\]\\n)* *(?:unsafe )?extern "C" fn ${name}\\(`,
        "m",
      ).test(native);
    expect(called.filter(name => !standsIn(name))).toEqual([]);
  });
});
