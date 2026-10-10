// M6: a `#` at the start of a pattern. minimatch takes it for a comment, which matches nothing, unless `nocomment` is set. A caller
// that has `nocomment` (import/order) writes a `\` before it: that has to be what `{ nocomment: true }` says to the pattern as it is.
import { J, require } from "./refs.mjs";
const { minimatch } = require(J + "minimatch");
const patterns = ["#internal/**", "#*", "#", "#a/{b,c}/*", "#{a,b}", "##x", "#a?", "#!a", "#[ab]", "#a/**/b"];
// prettier-ignore
const paths = ["#internal/a", "#internal/a/b", "#internal", "#", "#a", "#b", "#ab", "##x", "#a/b/c", "#a/c/x", "#a/d/x", "#!a", "#a/b", "#a/x/y/b",
  "internal/a", "a", "#a/.x/b", "\\#a", "#x.js"];
export function* cases() {
  for (const dot of [false, true])
    for (const pattern of patterns)
      for (const path of paths) {
        const mode = dot ? "minimatch" : "minimatch-nodot";
        yield { it: { mode, pattern, path }, want: minimatch(path, pattern, { dot }) };
        yield { it: { mode, pattern: "\\" + pattern, path }, want: minimatch(path, pattern, { dot, nocomment: true }) };
      }
}
