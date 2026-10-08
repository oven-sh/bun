// Not a comparison: shapes of Markdown that take parsers a time that grows with the square of the length, or that nest without end. Each is
// formatted with a limit on memory and time. Prints what fails or takes more than a second, and what is answered with an error.
//
//   bun markdown-guards.ts <bun-lint>
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const [bin] = process.argv.slice(2);
const [n, m] = [200_000, 10_000];
const lines = (count: number, line: (index: number) => string) => Array.from({ length: count }, (_, index) => line(index)).join("");
const shapes: Record<string, string> = {
  quote_nested: ">".repeat(m) + " a", quote_lines: lines(399, i => ">".repeat(i + 1) + " a\n"), list_nested: "- ".repeat(m) + "a",
  list_steps: lines(m, i => "  ".repeat(i) + "- a\n"), ordered_nested: "1. ".repeat(m) + "a",
  ...Object.fromEntries([..."*_[]~`$<&\\({|#-=>"].map(it => [`run of ${it}`, it.repeat(n)])), bang_run: "![".repeat(n), space_run: " ".repeat(n) + "a", tab_run: "\t".repeat(n) + "a",
  star_open: "*a ".repeat(n), star_close: "a* ".repeat(n), star_pairs: "*a* ".repeat(n), star_nested: "*a ".repeat(n) + "b" + " c*".repeat(n), strong_mix: "*a **b ".repeat(n),
  under_mix: "_a __b ".repeat(n), three: "***a ".repeat(n) + "b*** ".repeat(n), mod3: "*a**b***c ".repeat(n), tilde_nested: "~~a ".repeat(n) + "b" + " c~~".repeat(n),
  link_nested: "[".repeat(n) + "a" + "](b)".repeat(n), image_nested: "![".repeat(n) + "a" + "](b)".repeat(n), link_open: "[a](".repeat(n), link_title: '[a](b "'.repeat(n),
  link_angle: "[a](<".repeat(n), link_ref: "[a][b".repeat(n), link_many: "[a](b)".repeat(n), ref_many: "[a]: b\n\n" + "[a]".repeat(n),
  ref_nested: "[a]: b\n\n" + "[".repeat(n) + "a" + "]".repeat(n), parens: "[a](" + "(".repeat(n) + ")".repeat(n) + ")",
  defs: lines(n / 4, i => `[a${i}]: b\n`), defs_same: "[a]: b\n".repeat(n / 2), def_label: "[" + "a".repeat(n) + "]: b", def_open: "[a]: <".repeat(n), def_title: '[a]: b "\n'.repeat(n / 4),
  foot_defs: lines(n / 8, i => `[^${i}]: b\n`), foot_calls: "[^a]: b\n\n" + "[^a]".repeat(n), foot_open: "[^".repeat(n),
  comment_open: "<!--".repeat(n), cdata_open: "<![CDATA[".repeat(n), pi_open: "<?".repeat(n), decl_open: "<!a".repeat(n), tag_open: "<a ".repeat(n), tag_attr: '<a b="'.repeat(n),
  tag_close: "</a".repeat(n), autolink_open: "<a:".repeat(n), email_open: "<a@".repeat(n),
  liquid_open: "{{".repeat(n), liquid_pct: "{%".repeat(n), wiki_open: "[[".repeat(n), math_open: "$$a".repeat(n), ticks: lines(3000, i => "`".repeat((i % 300) + 1) + "a"), ticks_same: "`a".repeat(n),
  www: "www.".repeat(n), http: "http://".repeat(n), http_a: "http://a".repeat(n), email: "a@".repeat(n), email_b: "a@b.".repeat(n), under_email: "_".repeat(n) + "@b.c",
  entity: "&amp;".repeat(n), entity_open: "&a".repeat(n), escapes: "\\*".repeat(n),
  table_wide: "|a".repeat(n / 4) + "\n" + "|-".repeat(n / 4) + "\n" + "|b".repeat(n / 4), table_long: "|a|b|\n|-|-|\n" + "|c|d|\n".repeat(n / 4),
  table_ragged: "|a|\n|-|\n" + lines(4999, i => "|b".repeat((i + 1) % 50) + "\n"), table_heads: "a|b\n".repeat(n / 4),
  paragraph_long: "a ".repeat(n), paragraph_lines: "a\n".repeat(n), lazy: "> a\n" + "b\n".repeat(n), setext: "a\n=\n".repeat(n / 4), headings: "# a\n".repeat(n / 2), breaks: "a  \n".repeat(n),
  thematic: "---\n".repeat(n), blank: "\n".repeat(n), items: "- a\n".repeat(n), items_loose: "- a\n\n".repeat(n), tasks: "- [ ] a\n".repeat(n), code_indented: "    a\n\n".repeat(n),
  fences: "```\n".repeat(n), fence_open: "```\n" + "a\n".repeat(n), html_blocks: "<div>\n\n".repeat(n), html_open: "<!--\n" + "a\n".repeat(n), cjk: "中".repeat(n), cjk_mixed: "中a".repeat(n),
  emoji: "😀".repeat(n), nul: "\0".repeat(n), front: "---\n" + "a: b\n".repeat(n) + "---\n", front_open: "---\n".repeat(3) + "a\n".repeat(n),
};
const file = join(mkdtempSync(join(tmpdir(), "markdown-guards-")), "input.md");
const [bad, refused]: string[][] = [[], []];
for (const [name, text] of Object.entries(shapes)) {
  writeFileSync(file, text + "\n");
  for (const flag of ["--proseWrap=preserve", "--proseWrap=always"]) {
    const start = performance.now();
    const result = Bun.spawnSync(["sh", "-c", 'ulimit -v 8000000; ulimit -c 0; exec "$0" format file "$1" "$2"', bin, file, flag], { timeout: 20_000 });
    const time = Math.round(performance.now() - start);
    if (result.exitCode !== 0 || time > 1000) bad.push(`${name} ${flag}: exit ${result.exitCode}, ${time} ms`);
    else if (result.stdout.toString().startsWith("NestedTooDeeply")) refused.push(name);
  }
}
console.log(bad.join("\n"));
console.log(`${Object.keys(shapes).length} shapes, ${bad.length} slow or failed. Answered with an error: ${[...new Set(refused)].join(", ")}`);
