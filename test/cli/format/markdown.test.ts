// Tests for Markdown in block quotes and list items. Where Prettier 3.9.9 and oxfmt 0.72.0 print one result for every
// spelling of a document, `bun fmt` prints it too. `own/cases/markdown` has more such inputs, recorded from both tools.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { endChildren, longLimit, spawn } from "../children";

afterAll(endChildren);

// Each row is a title, spellings of one document that differ only in the columns of their `>` markers, and the one
// output that Prettier 3.9.9 and the one that oxfmt 0.72.0 prints for every spelling.
const spellings: [title: string, texts: string[], byPrettier: string, byOxfmt: string][] = [
  [
    "a blank line after indented code, indented like the code",
    [
      "> > - a\n> >\n> >       code\n> >       \n> >   - b\n",
      "> > - a\n> >\n> >       code\n>>       \n> >   - b\n",
      ">> - a\n >>\n  > >       code\n   >>       \n> >   - b\n",
    ],
    "> > - a\n> >\n> >       code\n> >   - b\n",
    "> > - a\n> >\n> >       code\n> >\n> >   - b\n",
  ],
  [
    "the same blank line with one space less",
    [
      "> > - a\n> >\n> >       code\n> >      \n> >   - b\n",
      ">> - a\n>>\n>>       code\n> >      \n>>   - b\n",
      " > > - a\n> >\n>>       code\n  >>      \n > >   - b\n",
    ],
    "> > - a\n> >\n> >       code\n> >\n> >   - b\n",
    "> > - a\n> >\n> >       code\n> >\n> >   - b\n",
  ],
  [
    "a blank line after indented code that starts a list item",
    [
      "> -     code\n>       \n>   - b\n",
      " > -     code\n>       \n >   - b\n",
      "> -     code\n   >       \n>   - b\n",
    ],
    "> -     code\n>   - b\n",
    "> -     code\n>\n>   - b\n",
  ],
  [
    "a blank line indented more than the code, before the next list item",
    ["> -     code\n>        \n> - b\n", "   > -     code\n>        \n> - b\n", "> -     code\n >        \n> - b\n"],
    "> -     code\n>\n> - b\n",
    "> -     code\n>\n> - b\n",
  ],
  [
    "indented code that starts on the line that ends a block quote",
    [
      "> - > a\n>   >\n>       code\n>\n>       more\n>       \n>   - b\n",
      "> - > a\n>   >\n>       code\n>\n >       more\n>       \n>   - b\n",
      "> - > a\n>   >\n>       code\n>\n >       more\n   >       \n>   - b\n",
    ],
    "> - > a\n>\n>       code\n>\n>       more\n>   - b\n",
    "> - > a\n>\n>       code\n>\n>       more\n>\n>   - b\n",
  ],
  [
    "HTML right after a paragraph",
    ["> a\n> <div>\n", "   > a\n> <div>\n", "> a\n  > <div>\n"],
    "> a\n> <div>\n",
    "> a\n> <div>\n",
  ],
  [
    // Prettier's output isn't a fixed point: with the markers before it, the tag is a line of the paragraph.
    "a tag on a line without its block quote's marker",
    ["> > a\n>  </b>\n", "> > a\n >  </b>\n", ">> a\n  >  </b>\n"],
    "> > a\n> >  </b>\n",
    "> > a\n> >\n> >  </b>\n",
  ],
];

// Each row is the text and oxfmt 0.72.0's output: HTML that is in a list item stays in it. In Prettier's flavor,
// `bun fmt` prints what Prettier 3.9.9 prints, which depends on the column the paragraph starts in.
const inItem: [before: string, after: string][] = [
  ["- [ ] a\n  <div>\n", "- [ ] a\n  <div>\n"],
  ["- [x] a\n  <details>\n  b\n  </details>\n", "- [x] a\n  <details>\n  b\n  </details>\n"],
  ["1. [ ] a\n   <!-- b -->\n", "1. [ ] a\n   <!-- b -->\n"],
  ["- [ ] a\n   <div>\n", "- [ ] a\n   <div>\n"],
  ["- [ ] a\n\n  <div>\n", "- [ ] a\n\n  <div>\n"],
  ["-\ta\n\t<div>\n", "- a\n  <div>\n"],
  [" > - a\n>   <div>\n", "> - a\n>   <div>\n"],
  ["> > - a\n>>   <div>\n", "> > - a\n> >   <div>\n"],
  [" > 1. a\n>    <div>\n", "> 1.  a\n>     <div>\n"],
];

// The text, Bun's output in both flavors, and Prettier 3.9.9's output. Prettier ends the first item on the blank line,
// which is a line of its code, and prints a tight list. commonmark.js 0.31.2 renders the second item as
// `<li><p>b</p></li>` for the text and as `<li>b</li>` for Prettier's output.
const looseList = ["-     code\n      \n- b\n", "-     code\n\n- b\n", "-     code\n- b\n"];

const files: Record<string, string> = { "loose-list.md": looseList[0] };
spellings.forEach(([, texts], row) => texts.forEach((text, index) => (files[`spelling-${row}-${index}.md`] = text)));
inItem.forEach(([before, after], row) =>
  Object.assign(files, { [`item-${row}-a.md`]: before, [`item-${row}-b.md`]: after }),
);

/** Formats `files` in one `bun fmt` run and returns their new contents. */
async function format(args: string[]) {
  using dir = tempDir("bun-format-markdown", files);
  await using proc = spawn({
    cmd: [bunExe(), "fmt", ...args],
    env: bunEnv,
    cwd: String(dir),
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  const after = Object.keys(files).map(name => [name, readFileSync(join(String(dir), name), "utf8")]);
  return { files: Object.fromEntries(after) as Record<string, string>, stderr, exitCode };
}

let asPrettier: Awaited<ReturnType<typeof format>>;
let asOxfmt: Awaited<ReturnType<typeof format>>;
// A debug build that has not run yet takes longer to start twice than a hook has by default.
beforeAll(async () => {
  [asPrettier, asOxfmt] = await Promise.all([format([]), format(["--flavor=oxfmt"])]);
}, longLimit);

test("both runs succeed", () => {
  expect([asPrettier.stderr, asOxfmt.stderr].filter(stderr => stderr.includes("error"))).toEqual([]);
  expect([asPrettier.exitCode, asOxfmt.exitCode]).toEqual([0, 0]);
});

describe("prints one result for every spelling where Prettier and oxfmt print one", () => {
  test.each(spellings.map((row, index) => [row[0], index] as const))("%s", (_, row) => {
    const [, texts, byPrettier, byOxfmt] = spellings[row];
    const names = texts.map((_, index) => `spelling-${row}-${index}.md`);
    expect(names.map(name => asPrettier.files[name])).toEqual(texts.map(() => byPrettier));
    expect(names.map(name => asOxfmt.files[name])).toEqual(texts.map(() => byOxfmt));
  });
});

describe("with --flavor=oxfmt, HTML after a paragraph stays in its list item", () => {
  /** The rendered HTML, with every run of whitespace as one space. */
  const rendered = (text: string) => Bun.markdown.html(text).replace(/\s+/g, " ");

  test.each(inItem.map((row, index) => [row[0], index] as const))("%j", (before, row) => {
    const [, after] = inItem[row];
    expect(rendered(after)).toBe(rendered(before));
    const names = [`item-${row}-a.md`, `item-${row}-b.md`];
    expect(names.map(name => asOxfmt.files[name])).toEqual([after, after]);
  });
});

test("keeps a list loose where Prettier's tight list is another document", () => {
  const [, after, byPrettier] = looseList;
  expect(after).not.toBe(byPrettier);
  expect([asPrettier.files["loose-list.md"], asOxfmt.files["loose-list.md"]]).toEqual([after, after]);
});
