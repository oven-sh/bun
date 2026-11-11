import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// fd 0 can be O_NONBLOCK. The flag is on the open file description, which fd 1/2 and every program on the same
// terminal share, and `process.stdout` sets it on a socket. A plain `read` of stdin then fails with EAGAIN while there
// is no input yet, and a caller that takes the error for the end of the input leaves early.
//
// Read stdin with `bun_sys::read_stdin_blocking`, or through `bun_sys::File::stdin()`. Both wait.
test("Rust sources outside bun_sys do not read stdin with a plain read", async () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const banned = /\bread\s*\(\s*(?:\w+::)*Fd::stdin\s*\(\s*\)/;

  // Terminal probes with a deadline of their own. No answer in time means that the terminal has no answer.
  const known = new Map([["src/md/ansi_renderer.rs", 2]]);

  const found = new Map<string, number>();
  let scanned = 0;
  for await (const rel of new Glob("**/*.rs").scan({ cwd: path.join(repoRoot, "src") })) {
    const file = path.join("src", rel).replaceAll("\\", "/");
    if (file.startsWith("src/sys/")) continue;
    scanned++;
    const source = readFileSync(path.join(repoRoot, file), "utf8");
    if (!source.includes("Fd::stdin")) continue;
    const count = source.split("\n").filter(line => !/^\s*\/\//.test(line) && banned.test(line)).length;
    if (count > 0) found.set(file, count);
  }
  // Guard against repoRoot resolving wrong, which would make the ban pass vacuously.
  expect(scanned).toBeGreaterThan(1000);
  expect(Object.fromEntries([...found].sort())).toEqual(Object.fromEntries([...known].sort()));
});
