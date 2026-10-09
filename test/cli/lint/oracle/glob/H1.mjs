// H1: `heads`: what a path that matches starts with, up to a `/` or to its end. No judge for the list itself: a property. For every pair of M1 and M2 that the
// reference says matches, the path starts with one of the heads, or the pattern does not say. Counted: how many patterns say something.
import { generator } from "./gen.mjs";
import { generate } from "./M1.mjs";
import { J, require } from "./refs.mjs";
const { Minimatch } = require(J + "minimatch");
let says = 0,
  asked = 0;
export function* cases(seed, count) {
  for (const { it, want } of generate(seed, count, "minimatch", { dot: true }))
    if (want === true && !it.partial && !it.flipNegate)
      yield { it: { mode: "minimatch", pattern: it.pattern, path: it.path, ask: "heads" }, want: true };
  const g = generator(seed);
  for (let k = 0; k < 25000; k++) {
    const { pattern, paths } = g.pattern_and_paths();
    let m;
    try {
      m = new Minimatch(pattern, { dot: true });
    } catch {
      continue;
    }
    for (const parts of paths)
      if (m.match(parts.join("/")))
        yield { it: { mode: "minimatch", pattern, path: parts.join("/"), ask: "heads" }, want: true };
    for (const parts of paths) {
      const path = parts.join("/");
      for (const mode of ["bun", "oxc"])
        if (
          typeof Bun !== "undefined" &&
          new Bun.Glob(
            mode === "bun"
              ? pattern
              : pattern.startsWith("./")
                ? pattern.slice(2)
                : pattern.includes("/")
                  ? pattern
                  : "**/" + pattern,
          ).match(path)
        )
          yield { it: { mode, pattern, path, ask: "heads" }, want: true };
    }
  }
}
export function agrees(it, want, got) {
  asked++;
  if (got === null) return true;
  says++;
  // minimatch takes `//` for `/`.
  const path = it.mode === "minimatch" ? it.path.replace(/\/+/g, "/") : it.path;
  return got.some(head => path === head || path.startsWith(head + "/"));
}
export function report() {
  console.log(`  the pattern says what a match starts with in ${says} of ${asked} pairs`);
}
