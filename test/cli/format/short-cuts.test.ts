import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A formatter takes a short cut where the output is known without the general machinery. `--no-short-cuts` turns all of
// them off, and the output has to be the same. Each language has a `describe` of its own.

// The flag is only compiled into debug and canary builds.
const hasFlag = isDebug || Bun.spawnSync({ cmd: [bunExe(), "--revision"], env: bunEnv }).stdout.includes("canary");

/** Formats `texts` as files with the extension of `name`, with and without the short cuts. Returns what differs. */
async function differences(name: string, texts: string[], flags: string[]) {
  const files = Object.fromEntries(texts.map((text, index) => [`${index}/${name}`, text]));
  const results = await Promise.all(
    [[], ["--no-short-cuts"]].map(async own => {
      const dir = tempDir("format-short-cuts", files);
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "fmt",
          "--write",
          "--no-config",
          "--no-editorconfig",
          "--log-level=warn",
          ...flags,
          ...own,
          ".",
        ],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { dir, said: `${stdout}${stderr}`.split("\n").sort().join("\n"), exitCode };
    }),
  );
  const [short, long] = results;
  const different = texts.flatMap((text, index) => {
    const [a, b] = results.map(it => readFileSync(join(String(it.dir), `${index}/${name}`), "utf8"));
    return a === b ? [] : [{ text, short: a, long: b }];
  });
  for (const it of results) it.dir[Symbol.dispose]();
  return { different, said: [short.said, short.exitCode], expected: [long.said, long.exitCode] };
}

function expectSame(name: string, texts: string[], options: string[][]) {
  test.skipIf(!hasFlag).concurrent.each(options.map(flags => [flags.join(" ") || "defaults", flags] as const))(
    "%s",
    async (_, flags) => {
      const { different, said, expected } = await differences(name, texts, flags);
      expect(different).toEqual([]);
      expect(said).toEqual(expected);
    },
  );
}

describe("YAML", () => {
  const texts = [
    // The common shapes.
    "a: 1\nb:\n  c: d\n  e:\n    - f\n    - g: h\n      i: j\n",
    "a:   1\nb:\n    c: d\n    e:\n    - f\n    -   g\n",
    "a:\n- b\n- c:\n  - d\n",
    "- a\n- - b\n  - c\n- - - d\n",
    "a: 'b'\nc: \"d\"\n'e': f\n\"g\": h\ni: 'it''s'\nj: \"a\\\"b\"\nk: 'a\"b'\nl: \"it's\"\nm: 'a\\b'\nn: \"a\\nb\"\n",
    "- 'a'\n- \"b\"\n- 'a: b'\n- \"a # b\"\n- 'a': b\n- \"a\" b\n",
    "a: |\n  b\n  c\n\nd: >-\n    e\n\n    f\ng:\n  - |\n    h\n  - i\n",
    "a: |\n  b  \n  c\t\nd: |\n  e\n   \nf: |\n  g\n \nh: 1\n",
    "a: |+\n  b\n\nc: |2\n    d\ne: | # f\n  g\n",
    "a: [b, c]\nd: {e: f}\ng: []\nh: {}\ni: [ j , [k, l] ]\nm: { n: [o], p: {q: r} }\n- x\n",
    "a: [b, c] # d\ne: [" + "item, ".repeat(20) + "item]\nf:\n  [g,\n   h]\ni: [\n  j\n]\n",
    "a: *b\nc: &d e\nf: !!str g\n<<: *h\ni: &j\n  k: l\n*m : n\n",
    "a: b c\n  d e\nf: 'g\n  h'\ni:\n  j\nk: l\n",
    "---\na: 1\n---\nb: 2\n\n---\nc: 3\nd: 4\n\n---\ne: 5\n...\n",
    "# a\n---\nb: 1\n",
    "# a\n\n# b\n\n---\nc: 1\n",
    "# a\n\n---\nc: 1\n",
    "# only\n",
    "# only\n\n",
    "# a\n\n\n# b\n\n",
    "%YAML 1.2\n---\na: 1\n",
    "? a\n: b\n? c\n",
    "a:\tb\n",
    "a: b\n\tc: d\n",
    // Comments.
    "# a\n\n# b\na: 1 # c\n\n\n# d\nb: 2   # e\n  # f\nc:\n  # g\n  d: 3\n# h\n",
    "a:\n  b: 1\n  # c\n    # d\n# e\nf: 2\n",
    "a:\n  - b\n  # c\n  - d\n    # e\n# f\n",
    "a: # b\nc: # d\n  e: 1\nf: # g\n\n  h: 1\ni: # j\n  # k\n  l: 1\n",
    "- # a\n  # b\n  c: 1\n-  # d\n",
    "a: 1\n# prettier-ignore\nb:    2\n#prettier-ignore\x0b\nc:  3\n#\u00a0prettier-ignore\nd:  4\n",
    "a: 1 # 🚨\n# 🚨\nb: 2\n# c\u2028\nd: 3\ne: f\u2028\n# g\n",
    // What a fuzzer has found.
    "- !",
    "0: !",
    "- -",
    "1: &a",
    "0:\n  2: 1\n #",
    "- >\n  b\n #\n#",
    "1: |\n  t\n #\n#e",
    "- 0: >\n   t\n #\n#",
    "kkkkkkkkkkkkkkkkkkk0: #\n 0:",
    "0:\n 2: #\n - c",
    "- |\n  \u2028 \n #",
    "d: !l|+",
    "a: b ||\n  c",
    "- \ufeff: {}",
    "- \ufeffa: [b]",
    "a: &r #\n \u3000\n",
    "k: [a, b] # c\n\nl: {a: b}   #d\n  # e\nm:\n  - [a] # f\n",
    "\ufeffa: b",
    "a: 1\n\u00a0\nb: 2\n \u3000\nc: 3\n",
    "a: \u00a0\nb: ✅ c\n- \u3042\n",
    // The ends of a text.
    "a: 1",
    "a: 1\n\n\n",
    "\n\na: 1\n",
    "a:",
    "a: |\n  b",
    "a: 1\r\nb:\r\n    c: 2\r\n",
    "a: 1\rb: 2\r",
    "",
    "\n",
    " ",
    // Errors.
    "a: b: c\n",
    'a: "b\n',
    "a: [b\n",
    "a: 1\n b: 2\n",
    "a\n",
    "- a\nb: 1\n",
    "a: @b\n",
    "a: 1\0\n",
  ];
  // Lines are looked at 56 bytes at a time. Everything that ends a key, starts a comment or closes a string, at every
  // place around the ends of the first windows.
  for (let length = 40; length <= 125; length++) {
    const x = Buffer.alloc(length, "x").toString();
    texts.push(
      [
        `a: ${x}`,
        `${x}: b`,
        `${x}:`,
        `- ${x}`,
        `a: ${x} # c`,
        `a: ${x} #`,
        `a: ${x}# c`,
        `a: ${x}: c`,
        `a: ${x} :c`,
        `a: ${x}:`,
        `a: '${x}'`,
        `a: "${x}"`,
        `a: '${x}' # c`,
        `a: '${x}''`,
        `a: "${x}\\"`,
        `a: '${x}: # '`,
        `- '${x}'`,
        `a: ${x} `,
        `a: ${x}\t`,
        `# ${x}`,
        `# ${x} `,
        `${Buffer.alloc(length, " ")}# c`,
      ].join("\n\n") + "\n",
      `a:\n${Buffer.alloc(length, " ")}b: c\n${Buffer.alloc(length, " ")}d:\n${Buffer.alloc(length, " ")}- e\n`,
    );
  }
  expectSame("a.yaml", texts, [
    [],
    ["--tab-width=4", "--single-quote"],
    ["--tab-width=0"],
    ["--tab-width=300", "--print-width=1"],
    ["--print-width=20", "--no-bracket-spacing", "--trailing-comma=none"],
    ["--print-width=100000", "--use-tabs"],
    ["--end-of-line=crlf"],
    ["--end-of-line=cr"],
    ["--end-of-line=auto"],
    ["--prose-wrap=always"],
    ["--insert-pragma"],
    ["--require-pragma"],
  ]);

  describe("in Markdown", () => {
    const hosts = texts
      .slice(0, 60)
      .flatMap(text => [
        `---\n${text}\n---\n\ntext\n`,
        `- item\n\n  \`\`\`yaml\n${text.replace(/^/gm, "  ")}\n  \`\`\`\n`,
      ]);
    expectSame("a.md", hosts, [[], ["--tab-width=4", "--print-width=30"], ["--end-of-line=crlf"]]);
  });

  test.skipIf(!hasFlag)("a text that is formatted stays as it is", async () => {
    const formatted = [
      '# a\n\na: 1\nb:\n  - c\n  - d: e\n    f: |\n      g\n\n      h\n\n  # i\n  - j: "k" # l\nm: [n, o]\n',
      "---\na: 1\n---\nb: 2\n",
    ];
    using dir = tempDir(
      "format-short-cuts",
      Object.fromEntries(formatted.map((text, index) => [`${index}.yaml`, text])),
    );
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fmt", "--check", "--no-config", "--no-editorconfig", "."],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr: stderr.replace(/^.*\d+ files?.*$/gm, "").trim(), exitCode }).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
  });
});

describe("JSON", () => {
  const texts = [
    '{\n  "a": 1,\n  "b": [1, 2, 3],\n  "c": { "d": null },\n  "e": {\n    "f": true\n  }\n}\n',
    '{"a":1,"b":[1,2,3],"c":{"d":null},\n"e":{\n"f":true}}',
    '{\n    "a": 1,\n    "b": {\n        "c": 2\n    }\n}\n',
    '{\n\t"a": 1,\n\t"b": {\n\t\t"c": 2\n\t}\n}\n',
    '{\n  "a" : 1 ,\n  "b":  2\n}\n',
    '{\n  "a": 1,\n\n\n  "b": 2,\n\n  "c": 3\n}\n',
    "[" + Array.from({ length: 60 }, (_, i) => i).join(", ") + "]\n",
    "[\n  " + Array.from({ length: 60 }, (_, i) => i).join(",\n  ") + "\n]\n",
    "[[1, 2], [3, 4]]\n",
    '[{"a": 1, "b": 2}, {"a": 3, "b": 4}]\n',
    "[1,,2,]\n",
    "{a: 1, 'b': 'c', 2: 1.50, d: +1, e: .5, f: 0XAB, g: `h`, i: NaN}\n",
    '{"a": "b\\\nc", "d": "\\u00e9", "e": "é", "f": "漢字"}\n',
    '{"a": 1} ',
    '{"a": 1}\r\n',
    '{\r\n  "a": 1,\r\n  "b": [\r\n    {}\r\n  ]\r\n}\r\n',
    '\ufeff{"a": 1}\n',
    '// a\n{"a": 1 /* b */}\n',
    "[]",
    "{}",
    "1",
    '"a"',
    "",
    "\n",
    '{"a": 1,}',
    '{"a" 1}',
    '{"a": 1',
    '{"version": "1", "name": "a", "dependencies": {"b": "1", "a": "2"}, "scripts": {"test": "x", "build": "y"}}\n',
  ];
  const options = [
    [],
    ["--tab-width=4"],
    ["--use-tabs"],
    ["--tab-width=0", "--print-width=1"],
    ["--print-width=20", "--no-bracket-spacing"],
    ["--end-of-line=crlf"],
    ["--end-of-line=auto"],
    ["--object-wrap=collapse", "--trailing-comma=none"],
    ["--quote-props=consistent", "--single-quote"],
  ];
  describe.each(["a.json", "package.json", "a.json5", "a.jsonc"])("%s", name => expectSame(name, texts, options));
  describe("sorted", () => expectSame("package.json", texts, [["--sort-package-json"]]));
});

describe("GraphQL", () => {
  // The flag is only compiled into debug and canary builds.
  const hasFlag = isDebug || Bun.spawnSync({ cmd: [bunExe(), "--revision"], env: bunEnv }).stdout.includes("canary");

  /** Formats `texts` as files, with and without the short cuts. */
  async function format(texts: string[], flags: string[]) {
    const files = Object.fromEntries(texts.map((text, index) => [`${index}.graphql`, text]));
    return await Promise.all(
      [[], ["--no-short-cuts"]].map(async own => {
        using dir = tempDir("format-short-cuts-graphql", files);
        await using proc = Bun.spawn({
          cmd: [
            bunExe(),
            "fmt",
            "--write",
            "--no-config",
            "--no-editorconfig",
            "--log-level=warn",
            ...flags,
            ...own,
            ".",
          ],
          cwd: String(dir),
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return {
          texts: texts.map((_, index) => readFileSync(join(String(dir), `${index}.graphql`), "utf8")),
          said: `${stdout}${stderr}`.split("\n").sort().join("\n"),
          exitCode,
        };
      }),
    );
  }

  const long = "a".repeat(30);
  const texts = [
    // Written as it's printed, and not.
    "query A {\n  a\n  b: c\n  ...D\n  ... on E {\n    f\n  }\n}\n",
    "query A{a,b:c,...D,... on E{f}}",
    "{a{b{c{d}}}}\n\n\n\n{ e }\nquery   { f }\n",
    "type A {\n  a: B\n  c: [D!]!\n\n  e(f: G = 1, h: [I] = [1, 2]): J @k\n}\n",
    "type A{a:B,c:[D!]!,e(f:G=1,h:[I]=[1,2]):J@k}",
    "    type A {\n        a: B\n\tc: D\n}\n",
    "schema { query: A mutation: B }\nextend schema @a\nextend schema { subscription: C }\n",
    "scalar A\nscalar B @c\nextend scalar D @e\nenum F { G H @i }\nextend enum F { J }\ninput K { l: M = { n: 1 } }\n",
    "union A = B | C\nunion D = | E | F\nunion G\nextend union H = I\nunion J @k = L\n",
    `union A = ${long} | ${long} | ${long}\n`,
    "interface A implements B & C { d: E }\ntype F implements & G & H\ntype I implements J @k { l: M }\n",
    `type A implements ${long} & ${long} & ${long} { b: C }\n`,
    "directive @a(b: C = 1 @d) repeatable on FIELD | QUERY\ndirective @e on | FIELD\nextend directive @f @g\n",
    "fragment A on B { c }\nfragment D($e: F = 1) on G @h { i }\n{ ...J(k: 1) @l }\n",
    "query A($b: C = 1 @d, $e: [F!]! = [1]) @g(h: 1) @i { j }\nsubscription { a }\nmutation B { c }\nquery ($a: B) { c }\n",
    // What doesn't fit.
    `{ a(b: "${long}", c: "${long}", d: "${long}") { e } }\n`,
    `{ a(b: { c: "${long}", d: ["${long}", "${long}", "${long}"] }) }\n`,
    `{\n  a(\n    b: 1\n    c: 2\n  )\n  d(\n    e: "${long}${long}${long}"\n  ) {\n    f\n  }\n}\n`,
    `{ a @${long}(b: 1) @${long}(c: 2) @${long}(d: 3) { e } }\n`,
    `query ${long}($a: ${long}, $b: ${long}) @${long} @${long} @${long} { c }\n`,
    `type A { ${long}(b: ${long}, c: ${long}): ${long} @${long} @${long} }\n`,
    `type A { b(c: D): ${long}${long}${long} @e(f: 1) }\n`,
    `{ a(b: [[[[["${long}", "${long}"], ["${long}"]]]]]) }\n`,
    "{ a(b: [], c: {}, d: [[]], e: { f: {} }) }\n",
    // Lines that are kept, in lists that keep them and in lists that don't.
    "{ a(b: 1\n\n\nc: 2) }\n",
    "{ a(b: [1\n\n2], c: { d: 1\n\ne: 2 }) }\n",
    "query ($a: B\n\n$c: D) { e }\n",
    "type A { b(c: D\n\n e: F): G }\n",
    "{\n  a\n\n\n  b\n  ,\n  c\n\n  ,\n\n  d ,\n\n  e\n}\n",
    // Comments between items, and elsewhere.
    "# a\n\n# b\n{ c } # d\n# e\n\n# f\n{ g }\n# h\n\n\n# i",
    "{\n  # a\n  b # c\n  # d\n\n  # e\n  f\n  # g\n\n  # h\n}\n",
    "{ # a\n  b\n}\ntype C { # d\n  e: F\n}\n",
    "type A {\n  # b\n  c: D # e\n  , # f\n  g: H\n}\n",
    "{ a(\n  # b\n  c: 1 # d\n  # e\n\n  f: 2\n) }\n",
    "{ a(c: 1, # d\n  f: 2 # g\n) }\n",
    "{ a(c: 1\n  # g\n) }\n{ a(c: 1 # h\n) @i }\n",
    "{ a( # b\n c: 1) }\n{ a(b: [ # c\n 1\n # d\n 2]) }\n{ a(b: {\n # c\n d: 1 }) }\n{ a(b: [\n # c\n]) }\n",
    "query ( # a\n $b: C # d\n $e: F\n) { g }\n",
    "type A # b\n{ c: D }\ntype E # f\nimplements G\n{ a # b\n (c: 1) }\n{ a # b\n { c } }\n{ a # b\n : c }\n",
    "type A implements B &\n# c\nD { e: F }\n",
    '"a" # b\ntype C\n"""d"""\n# e\ntype F { "g" # h\n i: J }\n',
    "# prettier-ignore\n{a}\n{b}\n",
    "{\n  # prettier-ignore\n  a(b:1)\n  c(d:1)\n}\n{ a # prettier-ignore\n}\n",
    "#\n#a\n#  b  \n{ c }#d\n",
    // Strings.
    '"a" type B { "c" d: E "f" g(h: I "j" k: L): M }\n',
    '"""a""" type B { """c""" d: E """f""" g(h: I """j""" k: L): M }\n',
    '"""\na\n"""\ntype B {\n  """\n  c\n\n  d\n  """\n  e: F\n}\n',
    '"""\n    a\n      b\n\n\n\n    c\n"""\ntype D\n',
    '""" a """ type B\n"""a """ type B\n""" a\n""" type B\n"""\n a  \n b\t\n""" type B\n"""\n\n   \n""" type B\n"""""" type B\n',
    '"""\n a\n   \n b\n""" type C\n"""a\n  b\n c""" type D\n"""\n\ta\n\t\tb\n""" type E\n',
    '"""a \\""" b""" type C\n{ a(b: """c""", d: """\ne\n""") }\n',
    '{ a(b: "c\\"d", e: "\\u00e9\\n\\t\\\\", f: "\\u{1F600}", g: "\\r") }\n',
    `{ a(b: "漢字漢字漢字漢字漢字漢字漢字漢字漢字漢字", c: "漢字漢字漢字漢字漢字漢字漢字漢字漢字漢字漢字漢") }\n`,
    `{ a(b: "éééééééééééééééééééééééééééééééééé", c: "ééééééééééééééééééééééééééééé") }\n`,
    '{ a(b: "\t\x7f\x01", c: "😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀") }\n',
    // Tokens.
    "{ a(b: $c, d: [$e$f], g: -1.5e+3, h: 0, i: true, j: null, k: ENUM, l: 1e5) }\n",
    "﻿{ a }\n{ ﻿ b }\n",
    "{ a }\r\n{ b(c: 1\r\n\r\nd: 2) }\r\n",
    "{ a }\r{ b }\r",
    `{ ${"a".repeat(70)} ${"b".repeat(200)}(c: 1) }\n`,
    `{ a(b: [$${"a".repeat(70)}$${"b".repeat(130)}$c]) }\n`,
    `{ ${"a { ".repeat(70)}b${" }".repeat(70)} }\n`,
    `{ a(b: ${"[".repeat(70)}1${"]".repeat(70)}) }\n`,
    `type A { b: ${"[".repeat(70)}C${"]".repeat(70)} }\n`,
    // Errors.
    "{ a",
    "{ a }}",
    "{ a(b: ) }",
    "{ a }\n{ b(c: 01) }",
    '{ a }\n{ b(c: "d) }',
    '{ a }\n"""b',
    "{ a }\ntype B { c: D = 1 }",
    "{ a }\nenum B { true }",
    "{ a }\nextend type B",
    "{ a }\ndirective @b on C",
    "{ a }\nquery ($b: C = $d) { e }",
    "{ a }\nfragment on on B { c }",
    "{ a }\n{ ...B { c } }",
    "{ a }\n{ b ? }",
    "{ a }\n{ b   c }",
    '"a" { b }',
    '"a" extend type B @c',
    "# a",
    "",
    "\n\n",
  ];

  test
    .skipIf(!hasFlag)
    .concurrent.each(
      [
        [],
        ["--print-width=40"],
        ["--print-width=1"],
        ["--print-width=100000"],
        ["--tab-width=4"],
        ["--tab-width=0"],
        ["--tab-width=5000", "--print-width=20"],
        ["--use-tabs"],
        ["--use-tabs", "--tab-width=8", "--print-width=30"],
        ["--no-bracket-spacing"],
        ["--end-of-line=crlf"],
        ["--end-of-line=cr"],
        ["--end-of-line=auto"],
        ["--insert-pragma"],
        ["--require-pragma"],
      ].map(flags => [flags.join(" ") || "defaults", flags] as const),
    )("%s", async (_, flags) => {
    const [short, long] = await format(texts, flags);
    expect(short.texts).toEqual(long.texts);
    expect(short.said).toEqual(long.said);
    expect(short.exitCode).toBe(long.exitCode);
  });

  test.skipIf(!hasFlag)("what has been formatted", async () => {
    const [formatted] = await format(texts, []);
    const [short, long] = await format(formatted.texts, []);
    expect(short.texts).toEqual(long.texts);
    expect(short.said).toEqual(long.said);
  });
});

const markdownOptions = [
  [],
  ["--embedded-language-formatting=off"],
  ["--tab-width=4"],
  ["--tab-width=3"],
  ["--tab-width=0"],
  ["--tab-width=5000"],
  ["--use-tabs"],
  ["--print-width=1"],
  ["--end-of-line=crlf"],
  ["--end-of-line=cr"],
  ["--prose-wrap=always"],
  ["--prose-wrap=never"],
  ["--single-quote"],
  ["--insert-pragma"],
];

describe("Markdown", () => {
  const texts = [
    // The common shapes.
    "# Title\n\nA paragraph with `code`, a [link](https://example.com/a_b?c=d&e) and **strong** words.\nIts second line.\n\n## Next\n\n---\n\nThe end.\n",
    "# Title\nText right below it.\n## Next\n```sh\nls\n```\nMore text.\n---\nThe end",
    "Text\n\n\n\nafter three empty lines.\n \n\t\nAnd after lines of white space.\n\n\n",
    "---\ntitle: a\n---\n\n# Title\n\nText.\n",
    "---\ntitle:   a\n---\n{{ liquid }}\n\nText.\n",
    "\n\n# After empty lines\n",
    "\ufeff# After a byte order mark\n\nText.\n",
    "Text without a line break at its end",
    "A line  with two spaces, one at its end \nand a hard break  \nand `two  in code` and ![two  in an image](a).\n",
    "Windows\r\n\r\n- line\r\n- endings\r\n\r\n| a | b |\r\n| - | - |\r\n| c | d |\r\n",
    "a\0b\n\n# c\n",
    "\f\n# e\n",
    // Code.
    "```js\nconst  a = 1\n```\n\n```\nplain\n```\n\n```unknown meta  data\n  kept  \n```\n\n```ts title=\"a\"\nlet  b\n```\n",
    "```\n```\n\n```\n\n```\n\n``` js\na\n```\n\n```js \na\n```\n\n````md\n```js\na\n```\n````\n\n~~~\na\n~~~\n",
    "```js\na\n ```\n\n```js\na\n```  \n\n```js\n`` ``` ``\n```\n\n```a`b\n```\n\n```a\\b &amp;\nc\n```\n\n```js\nnot closed\n",
    "```css\na{b:c}\n```\n\n```json\n{\"a\":1}\n```\n\n```yaml\na:   1\n```\n\n```html\n<p>a</p>\n```\n\n```js\nsyntax error (\n```\n",
    // Emphasis, and what only looks like it.
    "*a* and _b_ and *two words* and (*c*) and *d*.\n\na*b*c and a_b_c and snake_case_name and _open and 2 * 3 and *.txt\n",
    "**a** and __b__ and **a_b** and **a\\*b** and ***c*** and **a* b and *a** b\n\n_a_ _b_ and *a*_b_ and _a *b* c_ and _a_b and a_ b_\n",
    "_[a](b)_ and [_a_](b) and [*a*](b) and [**a**](b) and ~~a~~ and ~a~ and ~~~a\n",
    "**a\u2028** b and **\u2029a** b and **\u00a0a** and **中文**中文 and 中文**中文**\n",
    "e\n*http://a\n\ne\n*a*\n\ne\n**a**\n\ne\n* a\n",
    // Code spans.
    "`a` and `` a`b `` and `` `a` `` and ` a ` and `  ` and ` a` and ``a`` and `a\nb` and `not closed\n",
    "`a {{ b` }} *c* `d` and {{ a ` b }} *c* ` d\n",
    // Links, images, references.
    "[a](b) [a](<b c>) [a](b \"c\") [a](b 'c') [a](b (c)) [a](b \"c'd\") [a]() [a](b(c)d) [a](b\\)c) [a](b&amp;c) [a](b&c)\n",
    "[a] [a][b] [a][] [a]: b [^a] [[a]] ![a](b) ![a] ![a][b] [![a](b)](c) [a [b](c)](d) a] b [c\n\n[a]: d\n",
    "\\[a] and \\[[a](b)] and \\[[a]] and a\\\nb and \\_a\\_ and a\\",
    "[a\nb](c) and [a](b\nc)\n\n[*a*]\n\n[*a*]: b\n",
    // Addresses.
    "See http://a.b/c_d, https://a.b/c?d=e&f#g (http://a.b/c) and www.a.b and WWW.A.B and a@b.c and a_b@c.d.\n",
    "http://a.b/*c* and http://a.b/_c_ and http://a.b`c` and http://a.b[c] and [http://a.b](http://a.b) and now. www\n",
    "<http://a.b> <a@b.c> <a b> <a> </a> <a b=\"c*d*\"> <a\nb> < a <= b <1@b.c> <!-- c --> <?php ?> <br/> a<b>c\n",
    // What a line of a paragraph starts with.
    "a\n1. b\n\na\n2. b\n\na\n1986. b\n\na\n1986 b\n\na\n- b\n\na\n-b\n\na\n+ b\n\na\n# b\n\na\n#b\n\na\n> b\n\na\n=\n\na\n-\n\na\n---\n",
    "a\n```\nb\n```\n\na\n```b`c\n\na\n~~~\nb\n~~~\n\na\n$$\nb\n$$\n\na\n<div>\n\na\n<b>\n\na\n<b>\n:\n\na\n:::\n\na\n:-\n\na\n| b |\n\na | b\n- | -\n",
    "a\n b\n  c\n    d\n\ta\n\na\n    {{}}\n\na\n    - b\n",
    "}\n>2. a\n\n}\n>1. a\n\n}\n- 2. a\n",
    ":::tip\na\n:::\n\n::: a\n\nb\n\n:::\n",
    // Liquid.
    "{{ a }}\n\n{% b %}\n{{ c }}\ntext\n{{ d }}\n# e\n{{ f }}\n<div>\n</div>\n{{ g }}\n\n{{ h }} \n# i\n\n{{ j\n}}\n\n{{ k }} l {{ m }}\n",
    "n\n{{}}\n#\n\n{{}}\nn\n-\n\n{{}}\n|\n\n{{}}\n>\n\n{{}}\n~\n\n{{}}\ni  \n",
    "[a]({{ b }}) and [a]({{< b \"c\" >}}) and ![a]({{ b }}) and [a](b{{ c }})\n",
    // HTML.
    "<div>\n  <p>*a*</p>  \n\n</div>\n\n<img src=\"a\">\n\n<img src=\"a\"> b\n\n<span>a</span> *b*\n\n<my-element>\n\n<p-a>\n\n</div>\n  \n<div>\n",
    "<!-- a -->\n\n<!-- a\nb -->\n\n<!-- a --> b\n\n<!-->\n<n s=\"\">\n\n<!-- a -->\n<div>\n\n<style>\n\na {}\n</style>\n\n<pre>\n\n</pre>\n",
    "<g s=\"\">\n\ufeff",
    "<div>\n\u00a0\n",
    // Comments that tell the printer to leave something alone.
    "<!-- prettier-ignore -->\n| a | b |\n|--|--|\n\n| a | b |\n|--|--|\n",
    "<!--prettier-ignore-->\ns\n\n\ne\n\n<!--prettier-ignore-->\n# N\ns\n\n<!--prettier-ignore-->\n*a*  b\n- s\n",
    "<!-- prettier-ignore-start -->\n*a*\n\n| a |\n|-|\n<!-- prettier-ignore-end -->\n\n*b*\n",
    // Lists.
    "- a\n- b\n  c\n- d\n\n- e\n\n- f\n  - g\n    - h\n  - i\n\n  - j\n- k\n",
    "* a\n* b\n  + c\n  + d\n\ntext\n\n+ e\n",
    "- a\n\n* b\n\n+ c\n\n- d\n\n\n- e\n",
    "- a\n\n  b\n\n- c\n\n      d\n\n- e\n  ```\n  f\n  ```\n\n- g\n  > h\n\n- i\nj\n\n- k\n   l\n",
    "- [ ] a\n- [x] b\n- [X] c\n- [a](b)\n- [ ]\n",
    "-  a\n-   b\n-\n- \n-\tc\n - d\n",
    "- - a\n- # b\n- > c\n- 1. d\n- ---\n- * * *\n",
    "- t\n  {{}}\n\n- {{ a }}\n\n- a\n{{ b }}\n",
    "- a\n\n    code\n\n- a\n\n<!-- -->\n\n    code\n",
    "1. a\n2. b\n3. c\n\ntext\n\n1. a\n1. b\n1. c\n\ntext\n\n0. a\n1. b\n1. c\n\ntext\n\n0. a\n1. b\n2. c\n\ntext\n\n5. a\n7. b\n",
    "1. a\n   b\n2. c\n   1. d\n   2. e\n   - f\n\n9. a\n10. b\n    c\n\n1) a\n2) b\n\n01. a\n\n1234567890. a\n\n1.  a\n2.  b\n",
    "1. a\n\n2. b\n\n- c\n\n1. d\n\n1) e\n",
    "- a\n  2. b\n\n- a\n  1. b\n\n1. a\n  - b\n",
    // Block quotes.
    "> a\n> b\n>\n> c\n\n> a\nb\n\n>a\n\n>  a\n\n> # a\n\n> - a\n\n> > a\n\n>\n> a\n\n> a\n>\n\n> a\n> \n> b\n\n> a\n> {{ b }}\n",
    // Tables.
    "| a | b |\n| --- | --- |\n| c | d |\n\n| a   | b   |\n| --- | --- |\n| c   | d   |\n",
    "| a | b | c | d |\n|:-|-:|:-:|-|\n| left | right | center | none |\n| 中文 | é | 😀 | `a\\|b` |\n|||||\n",
    "| a |\n|-|\n| b | c |\n\n| a | b |\n|-|-|\n| c |\n\na | b\n-|-\nc | d\n\n| a |\n|-|\n| b\n\n| a |\n| b |\n\n| a |\n|-|\nb\n",
    "| a |\n|-|\n| *b* |\n| a  b |\n| a\\|b |\n| a\\\\|b |\n| <br> |\n| <a b=\"|\"> |\n| {{ c }} |\n| {{ c | d }} |\n| `a|b` |\n| [a](b) |\n| \ta |\n",
    "| a |\n|-|\n| b |\n{{ c }}\n\n| a |\n|-|\n  \ntext\n",
    "|||||\n|-|-|-|-|\n|||||\n",
  ];
  expectSame("a.md", texts, markdownOptions);
});

describe("MDX", () => {
  const texts = [
    "---\ntitle: a\n---\n\n# Title\n\nA paragraph with `code`, a [link](/a/b) and **strong** words.\nIts second line.\n\n```ts\nlet  a\n```\n\n---\n\nThe end.\n",
    "import a from  'a'\nexport const b = 1\n\nimportant text\n\nexports\n\ntext\nimport c from 'c'\n",
    "{/* a */}\n\n{/* a */}\n```js\nb\n```\n\n{/* a */}\ntext\n\n{/*a*/}\n\n{/*  a  */}\n\n{/* a */} b\n\n{/* a */} b {/* c */}\n\n{/* é */}\n\n# {/* a */}\n",
    "{/* prettier-ignore */}\n| a | b |\n|--|--|\n\n{/* prettier-ignore */}\n*a*  b\n\n*c*\n",
    "<A />\n\n<A>\n\ntext\n\n</A>\n\n<A b=\"c\">\n  <B>\n\n<A>b</A>\n\n<A.B c>\n\n<a-b>\n\n<pre>\n\n<A>\n  \n</A>\n\n<A>\n<!-- b -->\n\n<A b={c}>\n\n<>\n\n<A>\u00a0\n",
    "a <b>c</b> d <br/> e < f <= g <A b=\"*c*\" /> *h*\n\na {b} c {{ d }} e {% f %} g { h } i {/* j */}\n",
    "_a_ and *a* and _two words_ and a_b and a_b_ c and _a and snake_case `a_` and __a__\n\n**a** and **a b** and ** a** and **a **  and **a*b** and **`a*b`** and **a_b** and **[a](b)** and ***a***\n",
    "[a](b) and [a](b \"c\") and [a] and [a][b] and ![a](b) and [`a`](b) and [a](é) and [a\\]](b) and a] b\n\n[a](b)\n\n[a]: b\n",
    "a\\*b and a\\_b and a\\#b and a $b$ c and ~a~ and ~~a~~ and http://a.b and www.a.b and a@b.c\n",
    "**Note**: a\n\n🟢 a\n\n\u00a0a\n\n\ufeffa\n\n135 rules.\n\n1. a\n\n1.5 b\n\na\n**b**\n\na\n🟢 b\n\na\n1 b\n\na\u00a0\n",
    "- a\n- b\n  c\n- **d**\n\n- e\n  - f\n\n* g\n\n1. a\n2. b\n\n- a\n\n  b\n\n- [a](b)\n- _a_\n- 1,000\n",
    "- f\n  - g\n\n  - j\n- k\n\n- a\n  - b\n\n- c\n",
    "a_b\u00e9 and \u00e9a_b and a_b \u00e9\n",
    "> a\n> b\n>\n> c\n\n> a\nb\n",
    "| a | b |\n| --- | --- |\n| `c\\|d` | e\\|f |\n| <br/> | < 1 |\n| _g_ | **h** |\n\n| a |\n|-|\n| `b|c` |\n\n| a | b |\n|-|-|\n| c |\n",
    "{|||\n|-\n\n|||||\n|-|-|-:|-|\n",
    "\f\n```\n\n```\n",
    "a\n\n\n\nb\n# c\nd\n```\ne\n```\nf\n",
  ];
  expectSame("a.mdx", texts, markdownOptions);
});
