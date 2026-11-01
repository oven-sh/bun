import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// The crash handler runs where the allocator may have nothing left: on the thread of an out-of-memory crash, and in a
// signal handler. `Output::pretty_fmt::<..>()` and the other forms that rewrite `<tag>`s at run time build the text in a
// `Vec`, and an allocation that fails there ends the process in the middle of the report. `bun_core::pretty_fmt!`
// rewrites a literal template at compile time.
//
// The calls that no test runs are why this is a lint: the branch for a second thread that crashes, the hook for a Rust
// panic, the code for Windows.
test("the crash handler does not rewrite color tags at run time", async () => {
  const crate = path.resolve(import.meta.dir, "..", "..", "..", "src", "crash_handler");
  const atRunTime = /\bpretty_fmt(?:::<|_rt\b|_runtime\b|_args\b)/;
  expect('Output::pretty_fmt::<true>("<red>")').toMatch(atRunTime);
  expect('bun_core::pretty_fmt!("<red>", true)').not.toMatch(atRunTime);

  const found: string[] = [];
  let scanned = 0;
  for await (const file of new Glob("**/*.rs").scan({ cwd: crate })) {
    scanned++;
    readFileSync(path.join(crate, file), "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (atRunTime.test(line.replace(/\/\/.*/, "")))
          found.push(`src/crash_handler/${file}:${i + 1}: ${line.trim()}`);
      });
  }
  expect(scanned).toBeGreaterThan(0);
  expect(found.sort()).toEqual([]);
});
