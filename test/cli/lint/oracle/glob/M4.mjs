// M4: sections of an `.editorconfig`. The judge: `buildFullGlob` and `Minimatch` as in prettier/index.mjs (editorconfig-without-wasm),
// on absolute paths. Ours: what `full_glob` of src/lint/driver/fmt/editorconfig.rs has to write (below), `MINIMATCH_DOT`, on the absolute path too.
// Without the directory in front 103 of 20,000 differ: a `!` or `#` at the start of a section with a `/` becomes a negation or a comment,
// `..` is not resolved against the directory, `{a,}/b` gives `/b`.
import { random } from "./gen.mjs";
import { J, require } from "./refs.mjs";
const { Minimatch } = require(J + "minimatch");
const reference = (prefix, glob) => {
  switch (glob.indexOf("/")) { case -1: glob = `**/${glob}`; break; case 0: glob = glob.substring(1); break; }
  glob = glob.replace(/\\\\/g, "\\\\\\\\"); glob = glob.replace(/\*\*/g, "{*,**/**/**}");
  return new Minimatch(`${prefix}/${glob}`, { matchBase: true, dot: true });
};
export const full_glob = (directory, glob) => {
  const slash = glob.indexOf("/");
  glob = slash < 0 ? "**/" + glob : slash === 0 ? glob.slice(1) : glob;
  return directory + "/" + glob.replaceAll("\\\\", "\\\\\\\\").replaceAll("**", "{*,**/**/**}");
};
const seeds = ["*", "*.js", "*.{js,ts}", "{a,b}/**", "*.md", "**.js", "lib/**.js", "{1..3}", "/a.js", "a/b.js", "**/a.js", "*.{json,yml}", "Makefile", "{package.json,.travis.yml}", "[*.md]", "test/**", "**", "/**", "a/**/b", "*.[ch]", "[!a].js", "{*.js,*.ts}", "{a}", "{}", "a\\\\b", "\\*", "src/**/*.ts", ".*", "**/.*", "{a..c}.js", "***", "a**b", "!a", "#a"];
const alphabet = [..."*?[]{}!,./\\-ab1", "**", "/", "{a,b}", "..", "*."];
const names = ["a", "b", "lib", "src", "a.js", "b.ts", "x.md", ".a", "Makefile", "package.json", "1", "2", "a.c", "test", "*", "{a}", "a\\b", "!a", "#a"];
export function* cases(seed, count) {
  const { rnd, pick } = random(seed);
  const mutate = text => { const u = [...text]; for (let n = rnd(3); n > 0; n--) { const at = rnd(u.length + 1), r = rnd(3); if (r === 0) u.splice(at, 1); else if (r === 1) u.splice(at, 0, pick(alphabet)); else u.splice(at, 1, pick(alphabet)); } return u.join(""); };
  for (let k = 0; k < (count || 5000); k++) {
    const glob = k < seeds.length ? seeds[k] : mutate(pick(seeds));
    let m = null; try { m = reference("/w/p", glob); } catch {}
    const literal = glob.replace(/^\//, "").replace(/\*+/g, () => pick(names)).replace(/[\\{}[\]!]/g, "");
    for (let i = 0; i < 4; i++) {
      const path = i === 0 && literal && !literal.startsWith("/") ? literal : Array.from({ length: 1 + rnd(4) }, () => pick(names)).join("/");
      yield { it: { mode: "minimatch", pattern: full_glob("/w/p", glob), path: "/w/p/" + path }, want: m?.match("/w/p/" + path) };
    }
  }
}
