// I1, I2, I3: `Npm5`, `Npm705`, `Npm7012`, case on and off, `ignores` and `verdict`, against the three packages, in process.
// 25,000 files of lines x (the path and 5 that just miss, each as a directory too).
import { ignore_generator } from "./gen.mjs";
export function* generate(seed, count, mode, factory) {
  const g = ignore_generator(seed);
  for (let k = 0; k < (count || 25000); k++) {
    const { lines, path } = g.file_of_lines();
    const ignoreCase = g.rnd(2) === 0, as_text = g.rnd(3) === 0;
    const text = lines.join(g.pick(["\n", "\n", "\r\n"])) + g.pick(["", "\n"]);
    let it = null;
    try { it = factory({ allowRelativePaths: true, ignoreCase }).add(as_text ? text : lines); } catch {}
    const all = g.near(path), paths = [path];
    for (let i = 0; i < 5 && all.length; i++) paths.push(all.splice(g.rnd(all.length), 1)[0]);
    const given = as_text ? { text } : { lines };
    for (const p of paths) for (const q of [p, p.endsWith("/") ? p : p + "/"]) {
      let want; try { want = it?.ignores(q); } catch {}
      yield { it: { mode, ...given, ignoreCase, path: q, ask: "ignores" }, want };
      // What the rules say of this path alone.
      if (q.endsWith("//") || q === "/") continue;
      let one; try { const r = it && (it._rules.test ? it._rules.test(q, true, "regex") : it._testOne(q, true)); one = r && (r.ignored ? "ignored" : r.unignored ? "kept" : "none"); } catch {}
      yield { it: { mode, ...given, ignoreCase, path: q.endsWith("/") ? q.slice(0, -1) : q, directory: q.endsWith("/"), ask: "verdict" }, want: one ?? undefined };
    }
  }
}
