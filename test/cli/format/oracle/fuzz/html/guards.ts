// Not a comparison: shapes of HTML, Vue and Angular templates that nest without end or that take a careless formatter time in proportion to
// the square of their size. Each is formatted at a size and at four times that size. It fails if the process dies, if it takes longer than
// the limit, or if four times the size takes more than ten times as long.
//
//   bun guards.ts <bun-lint> <directory for a temporary directory> [-size=20000] [-limit=10000]
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const [bin, scratch, ...args] = process.argv.slice(2);
const flag = (name: string, otherwise: string) =>
  (args.find(it => it.startsWith(`-${name}=`)) ?? `-${name}=${otherwise}`).slice(name.length + 2);
const [size, limit] = [+flag("size", "20000"), +flag("limit", "10000")];

const times = (text: string, count: number) => Buffer.alloc(text.length * count, text).toString();
const inInterpolation = (make: (n: number) => string) => (n: number) => `{{ ${make(n)} }}`;
const inAttribute = (name: string, make: (n: number) => string) => (n: number) => `<a ${name}="${make(n)}"></a>`;
const expressionsOfAngular: Record<string, (n: number) => string> = {
  "parentheses": inInterpolation(n => times("(", n) + "a" + times(")", n)),
  "a sum": inInterpolation(n => "a" + times(" + a", n)),
  "negations": inInterpolation(n => times("!", n) + "a"),
  "signs": inInterpolation(n => times("-", n) + "a"),
  "conditions after the colon": inInterpolation(n => times("a ? a : ", n) + "a"),
  "conditions after the question mark": inInterpolation(n => times("a ? ", n) + "a" + times(" : a", n)),
  "arrays": inInterpolation(n => times("[", n) + times("]", n)),
  "objects": inAttribute("[b]", n => times("{a:", n) + "1" + times("}", n)),
  "arguments of a pipe": inInterpolation(n => "a | a" + times(" : a", n)),
  "pipes in arguments of pipes": inInterpolation(n => "a" + times(" | a : (a", n) + times(")", n)),
  "member accesses": inInterpolation(n => "a" + times(".a", n)),
  "calls": inInterpolation(n => "a" + times("()", n)),
  "calls in arguments": inInterpolation(n => times("a(", n) + times(")", n)),
  "keys in keys": inInterpolation(n => "a" + times("[a", n) + times("]", n)),
  "assertions": inInterpolation(n => "a" + times("!", n)),
  "powers": inInterpolation(n => "a" + times(" ** a", n)),
  "arrow functions": inInterpolation(n => times("a => ", n) + "a"),
  "parameters": inInterpolation(n => "(" + times("a,", n) + "a) => 1"),
  "names in parentheses that are not closed": inInterpolation(n => times("(a,", n)),
  "parentheses in an array": inInterpolation(n => "[" + times("(a),", n) + "]"),
  "templates in templates": inInterpolation(n => times("`${", n) + "a" + times("}`", n)),
  "tagged templates": inInterpolation(n => "a" + times("``", n)),
  "comparisons": inInterpolation(n => "a" + times(" < a", n)),
  "?? next to &&": inInterpolation(n => "a" + times(" ?? a && a", n)),
  "statements": inAttribute("(b)", n => "a()" + times("; a()", n)),
  "assignments": inAttribute("(b)", n => times("a = ", n) + "a"),
  "keys of a directive": inAttribute("*b", n => "a" + times("; b c", n)),
  "variables of a directive": inAttribute("*b", n => "let a" + times("; let a = b", n)),
  "aliases of a directive": inAttribute("*b", n => "a" + times("; a as b", n)),
  "interpolations in an attribute": inAttribute("b", n => times("{{a}}", n)),
  "interpolations in an attribute that do not end": inAttribute("b", n => times("{{a", n)),
  "line breaks around a dot": inInterpolation(n => "a" + times("\n", n) + "." + times("\n", n) + "b"),
  "escapes": inInterpolation(n => "'" + times("\\'", n) + "'"),
  "a comment": inInterpolation(n => "a //" + times(" b", n)),
};

// The name of the file, and the text for a size.
const shapes: Record<string, [string, (n: number) => string]> = {
  "nested blocks": ["a.html", n => times("<div>", n) + times("</div>", n)],
  "nested inline": ["a.html", n => times("<b>", n) + "a" + times("</b>", n)],
  "nested, never closed": ["a.html", n => times("<div><span>", n)],
  "nested lists": ["a.html", n => times("<ul><li>", n)],
  "nested unknown": ["a.html", n => times("<x-y>", n)],
  "nested svg": ["a.html", n => "<svg>" + times("<g>", n)],
  "void elements at the top of Vue": ["a.vue", n => times("<br/>", n)],
  "void elements and blanks at the top of Vue": ["a.vue", n => times("<br/> ", n)],
  "templates at the top of Vue": ["a.vue", n => times("<template></template>", n)],
  "start tags that do not end at the top of Vue": ["a.vue", n => times("<img ", n)],
  "nested templates": ["a.vue", n => times("<template>", n) + times("</template>", n)],
  "nested blocks of Angular": ["a.component.html", n => times("@if (a) {", n) + times("}", n)],
  "nested ICU": ["a.component.html", n => times("{a, plural, =0 {", n) + times("}}", n)],
  "nested conditional comments": ["a.html", n => times("<!--[if IE]><p>", n) + times("</p><![endif]-->", n)],
  "nested parentheses in an expression": [
    "a.vue",
    n => `<template><a :b="${times("(", n)}1${times(")", n)}"></a></template>`,
  ],
  "nested arrays in an interpolation": ["a.vue", n => `<template>{{ ${times("[", n)}${times("]", n)} }}</template>`],
  "nested pipes": ["a.component.html", n => `{{ ${times("(a | ", n)}b${times(")", n)} }}`],
  "siblings, block": ["a.html", n => times("<p>a</p>\n", n)],
  "siblings, inline": ["a.html", n => times("<b>a</b> ", n)],
  "siblings, inline, no space": ["a.html", n => times("<b>a</b>", n)],
  "siblings, void": ["a.html", n => times("<br>", n)],
  "paragraphs that are not closed": ["a.html", n => times("<p>a", n)],
  "items that are not closed": ["a.html", n => "<ul>" + times("<li>a", n)],
  "cells that are not closed": ["a.html", n => "<table>" + times("<tr><td>a", n)],
  "end tags without a start": ["a.html", n => "<div>" + times("</b>", n)],
  "words": ["a.html", n => times("word ", n)],
  "one word": ["a.html", n => times("w", n)],
  "lines": ["a.html", n => times("a\n", n)],
  "empty lines": ["a.html", n => "a" + times("\n", n) + "b"],
  "empty lines between elements": ["a.html", n => times("<p>a</p>\n\n\n\n", n)],
  "pre": ["a.html", n => "<pre>" + times("a\n", n) + "</pre>"],
  "textarea": ["a.html", n => "<textarea>" + times(" a\n", n) + "</textarea>"],
  "comments": ["a.html", n => times("<!-- a -->", n)],
  "a comment that is not closed": ["a.html", n => times("<!-- a ", n)],
  "ignored": ["a.html", n => times("<!-- prettier-ignore -->\n<p>  a </p>\n", n)],
  "display comments": ["a.html", n => times("<!-- display: block --><b>a</b>", n)],
  "attributes": ["a.html", n => "<a" + times(" b=c", n) + "></a>"],
  "attributes without a value": ["a.html", n => "<a" + times(" b", n) + ">"],
  "a long value": ["a.html", n => `<a b="${times("c ", n)}"></a>`],
  "classes": ["a.html", n => `<a class="${times("c ", n)}"></a>`],
  "a style attribute": ["a.html", n => `<a style="${times("b:c;", n)}"></a>`],
  "srcset": ["a.html", n => `<img srcset="${times("a 1x,", n)}b 2x">`],
  "a long address in a srcset": ["a.html", n => `<img srcset="${times("a", n)} 1x, ${times("b 2x, ", n / 4)}c 3x">`],
  "quotes in a value": ["a.html", n => `<a b='${times('"', n)}'></a>`],
  "entities": ["a.html", n => times("&amp;", n)],
  "ampersands": ["a.html", n => times("&", n)],
  "less than": ["a.html", n => times("< ", n)],
  "start tags that do not end": ["a.html", n => times("<a ", n)],
  "interpolations": ["a.vue", n => "<template><p>" + times("{{ a }} ", n) + "</p></template>"],
  "interpolations that do not end": ["a.vue", n => "<template><p>" + times("{{ a ", n) + "</p></template>"],
  "interpolations in Angular": ["a.component.html", n => times("{{ a | b }}", n)],
  "interpolations in pre": ["a.vue", n => "<template><pre>" + times("{{a}}", n) + "</pre></template>"],
  "interpolations in a textarea": ["a.component.html", n => "<textarea>" + times("{{a}}", n) + "</textarea>"],
  "blanks in v-for": ["a.vue", n => `<template><a v-for="a${times(" ", n)}b"></a></template>`],
  "end tags in a string of TypeScript": ["a.vue", n => `<script lang="ts">\na = "${times("</ ", n)}";\n</script>`],
  "lines before an end tag in a string of TypeScript": [
    "a.html",
    n => `<script lang="ts">\n${times("a;\n", n)}b = "</";\n</script>`,
  ],
  "names of attributes that are ignored": [
    "a.html",
    n => `<!-- prettier-ignore-attribute${times(" a", n)} -->\n<div${times(" b", n)}></div>`,
  ],
  "braces": ["a.component.html", n => times("{", n)],
  "at signs": ["a.component.html", n => times("@", n)],
  "declarations": ["a.component.html", n => times("@let a = 1;\n", n)],
  "filters": ["a.vue", n => `<template>{{ a${times(" | b", n)} }}</template>`],
  "pipes": ["a.component.html", n => `{{ a${times(" | b", n)} }}`],
  "statements in a handler": ["a.vue", n => `<template><a @b="${times("c();", n)}"></a></template>`],
  "bindings": ["a.vue", n => "<template><a" + times(' :b="c"', n) + "></a></template>"],
  "scripts": ["a.html", n => times("<script>a</script>", n)],
  "style sheets": ["a.html", n => times("<style>a{b:c}</style>", n)],
  "a script that is not closed": ["a.html", n => "<script>" + times("a;", n)],
  "custom blocks": ["a.vue", n => times("<i18n>{}</i18n>\n", n)],
  "front matter that does not end": ["a.html", n => "---\n" + times("a: b\n", n)],
  "doctypes": ["a.html", n => times("<!doctype html>", n)],
  "CDATA": ["a.html", n => "<svg>" + times("<![CDATA[a]]>", n) + "</svg>"],
  "options": ["a.html", n => "<select>" + times("<option>a", n)],
  ...Object.fromEntries(
    Object.entries(expressionsOfAngular).map(([name, make]) => [`Angular: ${name}`, ["a.component.html", make]]),
  ),
};

const directory = mkdtempSync(join(resolve(scratch), "html-guards-"));
let failures = 0;
try {
  for (const [name, [file, make]] of Object.entries(shapes)) {
    const took: number[] = [];
    let problem = "";
    for (const n of [size, size * 4]) {
      const path = join(directory, file);
      writeFileSync(path, make(n));
      const result = Bun.spawnSync([bin, "format", "file", path], {
        // The limit is on the time of the processor. The clock gets six times as much, for a busy machine.
        timeout: limit * 6,
        stdout: "ignore",
        stderr: "ignore",
      });
      // The time of the processor: on a busy machine the clock says little.
      took.push(Number(result.resourceUsage.cpuTime.total) / 1000);
      if (took.at(-1)! > limit) problem = "it takes too long";
      if (result.exitCode !== 0)
        problem ||= result.signalCode ? `ended by ${result.signalCode}` : `exit code ${result.exitCode}`;
    }
    // What a process costs by itself does not count.
    if (!problem && took[1] > 300 && took[1] > 10 * took[0]) problem = "not in proportion";
    if (problem) failures++;
    console.log(
      `${problem ? "FAIL" : "ok  "} ${name}: ${took.map(it => `${it.toFixed(0)} ms`).join(", ")}${problem && ` (${problem})`}`,
    );
  }
} finally {
  rmSync(directory, { recursive: true });
}
console.log(`${failures} of ${Object.keys(shapes).length} fail`);
