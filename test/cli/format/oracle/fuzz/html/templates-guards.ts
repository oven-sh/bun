// Not a comparison: shapes of HTML in the templates of JavaScript that nest without end or that take a careless formatter time in proportion
// to the square of their size. Each is formatted at a size and at four times that size. It fails if the process dies, if it takes longer
// than the limit, or if four times the size takes more than ten times as long.
//
//   bun templates-guards.ts <bun-lint> <directory for a temporary directory> [-size=5000] [-limit=10000]
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const [bin, scratch, ...args] = process.argv.slice(2);
const flag = (name: string, otherwise: string) =>
  (args.find(it => it.startsWith(`-${name}=`)) ?? `-${name}=${otherwise}`).slice(name.length + 2);
const [size, limit] = [+flag("size", "5000"), +flag("limit", "10000")];
const times = (text: string, count: number) => Buffer.alloc(text.length * count, text).toString();
const inTemplate = (text: string) => text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

const shapes: Record<string, (n: number) => string> = {
  "templates in substitutions": n => "a = " + times("html`<p>${", n) + "x" + times("}</p>`", n),
  "templates in arrow functions in calls": n => times("a.map((b) => html`\n<li>${", n) + "x" + times("}</li>\n`)", n),
  "templates in arguments": n => times("foo(html`<li>${", n) + "x" + times("}</li>`)", n),
  "templates in conditions": n => times("a ? html`<i>${b}</i>` : ", n) + "c",
  "templates, one per line": n => times("a = html`<b c=${x}>${y}</b>`;\n", n),
  "templates on one line": n => times("a = html`<b c=${x}>${y}</b>`;", n),
  "templates behind comments": n => times("a = /* HTML */ `<b c=${x}>${y}</b>`;\n", n),
  "comments before a template": n => "a = " + times("/* b */ ", n) + "/* HTML */ `<b>c</b>`",
  "templates that cannot be parsed": n => times("a = html`<b c=${x}></i>`;\n", n),
  "components": n => times('@Component({ template: `<b [c]="d">{{ e }}</b>` })\nclass A {}\n', n),
  "elements with substitutions": n => "a = html`" + times("<b c=${x}>${y}</b> ", n) + "`",
  "substitutions in a row": n => "a = html`" + times("${x}", n) + "`",
  "substitutions with spaces": n => "a = html`" + times("${x} ", n) + "`",
  "attributes": n => "a = html`<b" + times(' c="${x}"', n) + "></b>`",
  "substitutions in a value": n => 'a = html`<b c="' + times("${x} ", n) + '"></b>`',
  "substitutions in a comment": n => "a = html`<!--" + times("${x} ", n) + "-->`",
  "substitutions in a script": n => "a = html`<script>f(" + times("${x}, ", n) + ")</script>`",
  "substitutions in a style sheet": n => "a = html`<style>" + times("a { b: ${x} }", n) + "</style>`",
  "substitutions in pre": n => "a = html`<pre>" + times("${x}\n", n) + "</pre>`",
  "nested elements": n => "a = html`" + times("<div>", n) + "${x}" + times("</div>", n) + "`",
  "elements whose name is a substitution": n => "a = html`" + times("<${x}>", n) + "`",
  "what looks like a placeholder": n => "a = html`${x}" + times("PRETTIER_HTML_PLACEHOLDER_0_ ", n) + "`",
  "placeholders of nobody": n => "a = html`${x}" + times("PRETTIER_HTML_PLACEHOLDER_9_0_IN_JS ", n) + "`",
  "backslashes": n => "a = html`" + times("\\\\", n) + "`",
  "backticks": n => "a = html`" + times("\\`", n) + "`",
  "dollars": n => "a = html`" + times("$", n) + "`",
  "dollars and braces": n => "a = html`" + times("\\${", n) + "`",
  "end tags of scripts in a script": n => "a = html`<script>b = html\\`" + times("<\\\\/script>", n) + "\\`</script>`",
  "a template in a script in a template, and so on": n => {
    let code = "x = 1;";
    // The backslashes double with every level.
    for (let depth = Math.min(10, Math.floor(Math.log2(n))); depth > 0; depth--)
      code = "a = html`<script>" + inTemplate(code) + "</script>${y}`;";
    return code;
  },
  "blocks of code in Markdown": n => "a = md`\n" + times("~~~html\n<b   c>d</b>\n~~~\n\n", n) + "`",
};

const directory = mkdtempSync(join(resolve(scratch), "html-templates-guards-"));
let failures = 0;
try {
  for (const [name, make] of Object.entries(shapes)) {
    const took: number[] = [];
    let problem = "";
    for (const n of [size, size * 4]) {
      const path = join(directory, name.startsWith("components") ? "a.ts" : "a.js");
      writeFileSync(path, make(n) + "\n");
      const result = Bun.spawnSync([bin, "format", "file", path, "--embeddedHtml"], {
        // The limit is on the time of the processor. The clock gets six times as much, for a busy machine.
        timeout: limit * 6,
        stdout: "ignore",
        stderr: "ignore",
      });
      // The time of the processor: on a busy machine the clock says little.
      took.push(Number(result.resourceUsage.cpuTime.total) / 1000);
      if (took.at(-1)! > limit) problem = "it takes too long";
      if (result.exitCode !== 0) problem = result.exitCode === null ? "it was ended" : `exit code ${result.exitCode}`;
    }
    if (!problem && took[1] > 200 && took[1] > took[0] * 10)
      problem = "four times the size takes more than ten times as long";
    if (problem) failures++;
    console.log(`${problem ? "FAIL" : "ok  "} ${name}: ${took.map(it => it.toFixed(0)).join(" ms, ")} ms ${problem}`);
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
console.log(`${Object.keys(shapes).length - failures} of ${Object.keys(shapes).length} shapes are fine`);
process.exit(failures ? 1 : 0);
