import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// The crash handler runs where the allocator may have nothing left: on the thread of an out-of-memory crash, and in a
// signal handler. `Output::pretty_fmt::<..>()` rewrites `<tag>`s at run time into a `Vec`, and an allocation that fails
// there ends the process in the middle of the report. `bun_core::pretty_fmt!` rewrites a literal template at compile
// time.
//
// clippy.toml denies the other forms that rewrite at run time (`pretty_fmt_rt`, `pretty_fmt_runtime`,
// `pretty_fmt_args`). It cannot deny this one while calls outside the crash handler pass it a literal. Until those are
// converted and clippy.toml names it, this lint keeps it out of the crash handler: the tests that take the memory away
// do not reach every branch on every system.
test("the crash handler does not rewrite color tags at run time", async () => {
  const crate = path.resolve(import.meta.dir, "..", "..", "..", "src", "crash_handler");
  const atRunTime = /\bpretty_fmt::</;
  expect('Output::pretty_fmt::<true>("<red>")').toMatch(atRunTime);
  expect('bun_core::pretty_fmt!("<red>", true)').not.toMatch(atRunTime);

  const found: string[] = [];
  let scanned = 0;
  for await (const file of new Glob("**/*.rs").scan({ cwd: crate })) {
    scanned++;
    readFileSync(path.join(crate, file), "utf8")
      .split("\n")
      .forEach((line, i) => {
        // Not only the part before `//`: the templates of the report hold links, and a call can come after one.
        if (!/^\s*\/\//.test(line) && atRunTime.test(line))
          found.push(`src/crash_handler/${file}:${i + 1}: ${line.trim()}`);
      });
  }
  expect(scanned).toBeGreaterThan(0);
  expect(found.sort()).toEqual([]);
});
