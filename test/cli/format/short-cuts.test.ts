import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { readFileSync, readdirSync } from "node:fs";
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

/** How much time of the processor formatting `text` takes, as a multiple of what it takes without the short cuts. */
async function cpuTimeOfShortCuts(name: string, text: string) {
  using dir = tempDir("format-short-cuts", { [name]: text });
  const cpu = async (own: string[]) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fmt", "--check", "--no-config", "--no-editorconfig", "--log-level=silent", ...own, name],
      cwd: String(dir),
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;
    // (Windows counts in ticks of 1/64 s)
    return Math.max(Number(proc.resourceUsage()?.cpuTime.total ?? 0) / 1e6, 1 / 64);
  };
  return (await cpu([])) / (await cpu(["--no-short-cuts"]));
}

/** The most memory that formatting `text` takes at any time. */
async function memoryInMegabytes(name: string, text: string, flags: string[]) {
  using dir = tempDir("format-short-cuts", { [name]: text });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "fmt", "--check", "--no-config", "--no-editorconfig", "--log-level=silent", ...flags, name],
    cwd: String(dir),
    env: bunEnv,
    stdout: "ignore",
    stderr: "ignore",
  });
  await proc.exited;
  return (proc.resourceUsage()?.maxRSS ?? 0) / (1 << 20);
}

describe("YAML", () => {
  // An item with a block scalar in it doesn't go the long way by itself, whichever `#` starts the comment behind the header.
  const headersBehindQuotes = [
    'defaults: &defaults\n  "step #1": |+ # keep\n    echo hello\njobs: 1\n',
    "a: &b\n  'c #d': >+ # e\n    f\n\ng: 1\n",
    'a: &b\n  "c #d #e": |+ # f # g\n    h\ni: 1\n',
    'a: !!map\n  "c #d": &e |+ # f\n    g\nh: 1\n',
    'a: &b\n  "c #d": "|+ # e"\nf: 1\n',
    "- &a\n  - 'b #c': |+ #d\n      e\n- f\n",
  ];
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
    ...headersBehindQuotes,
    // Nothing starts a line in them, so only the long way finds out that the indentation would be too long.
    "a: [b, c]\n",
    "- {a: b}\n- [c]\n",
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
    ["--tab-width=4294967295"],
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
      .concat(headersBehindQuotes)
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
    // Written as it's printed, or nearly, which is told from the lines. Somewhere among these lengths a group gives way.
    ...Array.from({ length: 22 }, (_, index) => {
      const d = "D".repeat(52 + index);
      return [
        `type A {\n  b(\n    c: ${d}\n  ): E\n}\n`,
        `type A {\n  b(c: ${d}): E\n}\n`,
        `type A {\n  b(\n    c: ${d}\n  ): E @f\n}\n`,
        `type A {\n  b(\n    c: ${d}\n  ): E # f\n}\n`,
        `type A {\n  b(\n    c: ${d}\n  ): E\n    @f\n}\n`,
        `type A {\n  b(c: ${d}): E\n    @f\n}\n`,
        `type A {\n  b(c: ${d}): E @f\n}\n`,
        `type A {\n  b(\n    "c"\n    d: ${d}\n  ): E\n}\n`,
        `type A {\n  b: ${d}\n    @c(d: 1)\n}\n`,
        `type A {\n  b: ${d} @c(d: 1)\n}\n`,
        `type A {\n  b: ${d}\n    @c\n    @e(f: 1)\n}\n`,
        `type A {\n  b: C\n    @${d}(\n      e: 1\n    )\n}\n`,
        `type A {\n  b: C\n    @${d}(e: 1)\n}\n`,
        `input A {\n  b: ${d} = [1, 2]\n}\n`,
        `input A {\n  b: ${d} = [\n    1\n    2\n  ]\n}\n`,
        `input A {\n  b: ${d} = {\n    c: 1\n  }\n}\n`,
        `input A {\n  b: ${d} = { c: 1 }\n}\n`,
        `input A {\n  b: ${d} = {\n    c: 1\n  } @e\n}\n`,
        `input A {\n  b: ${d} = [1]\n    @e\n}\n`,
        `input A {\n  b: ${d} = 1\n    @e\n}\n`,
        `enum A {\n  ${d}\n    @b(c: 1)\n}\n`,
        `enum A {\n  ${d} @b(c: 1)\n}\n`,
        `{\n  a(\n    b: ${d}\n  )\n}\n`,
        `{\n  a(b: ${d})\n}\n`,
        `{\n  a(\n    b: ${d}\n  ) {\n    c\n  }\n}\n`,
        `{\n  a(b: ${d}) {\n    c\n  }\n}\n`,
        `{\n  a(\n    b: ${d}\n  ) @c {\n    d\n  }\n}\n`,
        `{\n  a(b: ${d})\n    @c {\n    d\n  }\n}\n`,
        `{\n  a(b: ${d})\n    @c\n}\n`,
        `{\n  a(b: ${d}) @c\n}\n`,
        `{\n  ${d}\n    @c(e: 1) {\n    f\n  }\n}\n`,
        `{\n  a\n    @${d}(e: 1) {\n    f\n  }\n}\n`,
        `{\n  a\n    @${d}(\n      e: 1\n    ) {\n    f\n  }\n}\n`,
        `{\n  a(\n    b: {\n      c: ${d}\n    }\n  )\n}\n`,
        `{\n  a(\n    b: { c: ${d} }\n  )\n}\n`,
        `{\n  a(\n    b: [\n      ${d}\n      E\n    ]\n    f: 1\n  )\n}\n`,
        `{\n  ...${d} @b(c: 1)\n  ... on ${d} @b(c: 1) {\n    e\n  }\n  ... @${d}(c: 1) {\n    e\n  }\n}\n`,
        `query A(\n  $b: ${d}\n) {\n  c\n}\n`,
        `query A($b: ${d}) {\n  c\n}\n`,
        `query A(\n  $b: ${d}\n) @c {\n  d\n}\n`,
        `query A(\n  $b: ${d} = 1 @c\n  $e: F\n) {\n  g\n}\n`,
        `query ($b: ${d}) {\n  c\n}\nmutation ${d} @b(c: 1) {\n  d\n}\n`,
        `fragment A on ${d} @b(c: 1) {\n  d\n}\n`,
        `type A implements B &\n  ${d} {\n  c: E\n}\n`,
        `type A implements B & ${d} {\n  c: E\n}\n`,
        `type A implements B &\n  ${d}\n\ntype F\n`,
        `interface A implements B & ${d}\n`,
        `union A =\n  | B\n  | ${d}\n`,
        `union A = B | ${d}\n`,
        `union ${d} @b(c: 1) = E\n`,
        `scalar ${d} @b(c: 1)\n`,
        `schema @${d}(c: 1) {\n  query: E\n}\n`,
        `directive @a(b: ${d}) repeatable on FIELD | QUERY\n`,
        `enum ${d} @b(c: 1) {\n  E\n}\ninput ${d} @b(c: 1) {\n  e: F\n}\n`,
      ];
    }).flat(),
    // What forces a list on lines, and what doesn't.
    'type A {\n  b(\n    """\n    c\n    """\n    d: E\n  ): F\n}\n',
    "type A {\n  b(\n    c: D\n\n    e: F\n  ): G\n}\n{\n  a(\n    b: 1\n\n    c: 2\n  )\n}\n",
    "query A(\n  $b: C\n\n  $d: E\n) {\n  f\n}\n",
    "{\n  a(\n    b: [\n      1\n\n      2\n    ]\n  )\n}\n",
    "{\n  a(\n    b: 1\n  )\n}\n",
    "type A {\n  b: C\n    @d(\n      e: 1\n\n      f: 2\n    )\n}\n",
    // Where a line of another kind goes on with what is in front of it.
    "enum A\n{\n  B\n}\n",
    "type A\n\n\n{\n  b: C\n}\n",
    "type A\n# b\n{\n  c: D\n}\n",
    "type A\nimplements B\n",
    "type A implements B\n& C\n",
    "type A\n\n\n\nimplements B {\n  c: D\n}\n",
    "type A\n,\n{\n  b: C\n}\n",
    "type A\n@b\n",
    "extend schema @a\n{\n  query: B\n}\n",
    "scalar A\n@b\n",
    "scalar A\n\n\n@b\n",
    "scalar A\n{\n  b\n}\n",
    "union A\n= B\n",
    "union A = B\n| C\n",
    "union A = B\n\n\n| C\n",
    "directive @a on FIELD\n| QUERY\n",
    'type A\ntype B\n\ntype C\n"d"\ntype E\n',
    "{\n  a\n  {\n    b\n  }\n}\n",
    "{\n  a\n  (b: 1)\n  c\n  @d\n  e\n  : f\n}\n",
    "{\n  ...\n  A\n  ...\n  on B {\n    c\n  }\n  ...on\n}\n",
    "type A {\n  b: C\n  @d\n  e: F\n  !\n  g: [H\n  ]\n}\n",
    "input A {\n  b: C\n  = 1\n}\n",
    "enum A {\n  B\n  @c\n}\n",
    // A text that starts as it's printed and goes on otherwise.
    ...[
      "type D{e:F}",
      "type D {\n  e:  F\n}\n",
      "{ a",
      "# prettier-ignore\ntype D{e:F}\n",
      "\n\n",
      "# d",
      "# d  \n",
      "",
      "  type D\n",
      "?",
    ].flatMap(rest => [
      `type A {\n  b: C\n}\n${rest}`,
      `type A {\n  b: C\n}\n\n${rest}`,
      `type A {\n  b: C\n}\n\n\n${rest}`,
      `type A {\n  b: C\n}\n# c\n${rest}`,
      `type A {\n  b: C\n}\n\n# c\n\n${rest}`,
      `type A {\n  b: C\n} # c\n${rest}`,
      `scalar A\n${rest}`,
      `# a\n\nscalar B\n\n${rest}`,
      `"""\na\n"""\nscalar B\n${rest}`,
    ]),
    // Nearly as it's printed.
    "type A {\n  b: C \n}\n",
    "type A {\n  b:  C\n}\n",
    "type A {\n  b:C\n}\n",
    "type A {\n  b : C\n}\n",
    "type A {\n   b: C\n}\n",
    "type A {\n b: C\n}\n",
    "type A {\n  b: C\n }\n",
    "type A {\n  b: C\n  }\n",
    "type A {\n\n  b: C\n}\n",
    "type A {\n  b: C\n\n}\n",
    "type A {\n  b: C\n\n\n  d: E\n}\n",
    "type A {\n  b: C\n  \n  d: E\n}\n",
    "type A  {\n  b: C\n}\n",
    "type  A {\n  b: C\n}\n",
    "type A{\n  b: C\n}\n",
    "type A {\n  b: C,\n  d: E\n}\n",
    "type A {\n  b: [C ]\n  d: [ E]\n  f: G !\n  h: [[I]!]!\n  j: [K!]]\n}\n",
    "type A {\n  b: C!!\n}\n",
    "type A {\n}\n",
    "type A {\n  # b\n}\n",
    "type A {\n  b: C #d\n  e: F  # g\n  h: I # j \n  k: L # m\n\n  n: O\n}\n",
    "type A {\n  b: C\n  # d\n\n  # e\n  f: G\n\n  # h\n}\n",
    "type A {\n  b: C\n  # d\n\n}\n",
    "type A {\n  b: C\n # d\n}\n",
    "type A {\n  b(c: D,e: F): G\n  h(i: J , k: L): M\n  n( o: P): Q\n  r(s: T ): U\n  v(): W\n  x (y: Z): A\n}\n",
    'type A {\n  b(c: D = 1, "e" f: G = [1, 2] @h, i: J = { k: 1 } @l(m: 1)): N\n}\n',
    'type A {\n  "b"\n  c: D\n  "e" f: G\n  "h"\n\n  i: J\n  ""\n  k: L\n  "m\'`$n"\n  o: P\n}\n',
    "{\n  a(b: {c: 1}, d: { e: 1}, f: {g: 1 }, h: {  }, i: [ ], j: [1,2], k: [1 , 2], l: [ 1], m: [1 ])\n}\n",
    "{\n  a(b: {}, c: [], d: [[], {}], e: { f: {}, g: [] })\n}\n",
    "{\n  a(b: $c, d: -1, e: 01, f: 1.5e3, g: 1., h: .5, i: 1a, j: $1, k: $, l: true)\n}\n",
    "{\n  a: b\n  c:d\n  e : f\n  g:  h\n  i: j {\n    k\n  }\n  l: m(n: 1) @o {\n    p\n  }\n}\n",
    "{\n  ...A\n  ... A\n  ...on\n  ... on B {\n    c\n  }\n  ...on D {\n    e\n  }\n  ... {\n    f\n  }\n  ...{\n    g\n  }\n  ...  on H {\n    i\n  }\n}\n",
    "{\n  ...A {\n    b\n  }\n}\n",
    "{\n  ... on A\n}\n",
    "{\n  ...A(b: 1) @c\n}\n",
    "schema {\n  query: A\n  mutation: B\n  subscription: C\n}\nschema {\n  a: B\n}\n",
    "enum A {\n  B\n  true\n}\n",
    'enum A {\n  B\n  C @d\n\n  "e"\n  F\n}\n',
    "query {\n  a\n}\nquery A {\n  b\n}\nquery  A {\n  c\n}\nquery A  {\n  d\n}\nquery A\n{\n  e\n}\nquery A (\n  $f: G\n) {\n  h\n}\n",
    "query A($b: C, $d: E = 1 @f) @g {\n  h\n}\nquery A($b: C = $d) {\n  e\n}\nquery A(b: C) {\n  d\n}\n",
    "fragment A on B {\n  c\n}\nfragment on on B {\n  c\n}\nfragment A  on B {\n  c\n}\nfragment A on B\n",
    "extend type A {\n  b: C\n}\nextend type D @e\nextend type F implements G\nextend type H\n",
    '"a"\nextend type B @c\n',
    "extend  type A @b\n",
    "extend query A {\n  b\n}\n",
    "directive @a on FIELD\ndirective @b repeatable on FIELD | QUERY\ndirective @c on A\ndirective @d on | FIELD\ndirective @e repeatableon FIELD\n",
    "union A\nunion B = C\nunion D = | E\nunion F =\n  | G\nunion H =\n",
    `union A =\n  | ${long}${long}\n  | ${long}\n  |  B\n`,
    `union A =\n  | ${long}${long}\n  | ${long}\n | B\n`,
    `type A implements ${long} &\n  ${long} &\n  ${long}\n  & B\n`,
    `type A implements ${long} &\n  ${long} & ${long} {\n  b: C\n}\n`,
    `type A implements ${long} &\n  ${long} &\n  ${long} @b {\n  c: D\n}\n`,
    `{\n${Array.from({ length: 30 }, (_, depth) => `${"  ".repeat(depth + 1)}a {\n`).join("")}${"  ".repeat(31)}b\n${Array.from({ length: 30 }, (_, depth) => `${"  ".repeat(30 - depth)}}\n`).join("")}}\n`,
    `{\n  ${"a".repeat(56)}\n  ${"a".repeat(57)}\n  ${"a".repeat(58)}: ${"b".repeat(120)}\n}\n`,
    "{\n  a$b\n}\n",
    "{\n  aé\n}\n",
    "{\n  a\n}",
    "{\n  a\n}\n\n",
    "\n{\n  a\n}\n",
    " {\n  a\n}\n",
    "# a\n",
    "# a\n{\n  b\n}\n# c\n",
    "# a\n\n\n{\n  b\n}\n",
    "{\n  a\n}\n{\n  b\n}\n\n{\n  c\n}\n",
    // Block strings, whose lines are looked at while their end is looked for.
    ...["", "  "].flatMap(indentation =>
      [
        '"""\n_a\n_"""',
        '"""\n_a\n_b\n_"""',
        '"""\n_a\n\n_b\n_"""',
        '"""\n_a\n_  b\n_"""',
        '"""\n_  a\n_b\n_"""',
        '"""\n_  a\n_  b\n_"""',
        '"""\n_a\n b\n_"""',
        '"""\n_a \n_"""',
        '"""\n_a\n_ \n_b\n_"""',
        '"""\n_a\n_\n_b\n_"""',
        '"""\n\n_a\n_"""',
        '"""\n_a\n\n_"""',
        '"""\n_a\n_ """',
        '"""\n_a\n"""',
        '"""\n_a"""',
        '"""a\n_"""',
        '""" \n_a\n_"""',
        '"""\n_"""',
        '"""\n_a \\""" b\n_"""',
        '"""\n_a\n_\\"""\n_"""',
        '"""\n_a "" b " c\n_"""',
        '"""\n_a\n_""""',
        '"""\n_é\' ` $ \\\\ \x7f\n_"""',
      ].map(
        string =>
          `type A {\n${indentation}${string.replaceAll("_", indentation)}\n${indentation}b: C\n}\n${string.replaceAll("_", "")}\ntype D\n`,
      ),
    ),
    `type A {\n${" ".repeat(60)}"""\n${" ".repeat(60)}a\n${" ".repeat(60)}"""\n  b: C\n}\n`,
    // An operation without a name has a blank in front of its variables.
    "query($a: Int) {\n  a\n}\n",
    "{\n  a\n}\n\nmutation($id: ID!) {\n  a(id: $id)\n}\n",
    "subscription($a: Int) @b {\n  a\n}\n",
    "query(\n  $someLongVariable: SomeLongType\n  $anotherLongVariable: AnotherLongType\n  $c: D\n) {\n  a\n}\n",
    "query ($a: Int) {\n  a\n}\n\nquery A($a: Int) {\n  a\n}\n\nquery A ($a: Int) {\n  a\n}\n",
    // A comment that ends with white space that isn't ASCII.
    ...["\u2028", "\u2029", "\u00a0", "\ufeff", "\u3000", "\u0085", "\u200b"].flatMap(space => [
      `{\n  a\n  # x${space}\n  # c\n}\n`,
      `{\n  a\n  # x${space}\n  b\n}\n`,
      `{\n  a # x${space}\n  b\n}\n`,
      `# x${space}\n# y\n{\n  a\n}\n`,
      `{\n  a\n}\n# x${space}\n\n# y\n`,
    ]),
    // How many blanks there are is only known for fewer than 57.
    ...[55, 56, 57, 60, 63, 64, 65].flatMap(blanks => {
      const indentation = " ".repeat(blanks);
      return [
        `type A implements B &\n${indentation}Cccc\n`,
        `type A implements B &\n${indentation}Cccc {\n${indentation}d: E\n}\n`,
        `union A =\n${indentation}| Bbbb\n${indentation}| Cccc\n`,
        `{\n${indentation}a\n}\n`,
        `{\n${" ".repeat(32)}a {\n${indentation}b\n${" ".repeat(32)}}\n}\n`,
        `{\n${" ".repeat(32)}a(\n${indentation}b: 1\n${" ".repeat(32)})\n}\n`,
        `type A {\n${" ".repeat(32)}a: B\n${indentation}@c\n${indentation}@d\n}\n`,
        `type A {\n${indentation}"a"\n${indentation}b: C\n}\n`,
      ];
    }),
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
        ["--tab-width=64", "--print-width=5"],
        ["--tab-width=32", "--print-width=40"],
        ["--tab-width=4294967295"],
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

  test.skipIf(!hasFlag)("long names with nothing but a `$` between them take linear time", async () => {
    const variables = `$${Buffer.alloc(70, "a")}`.repeat(isDebug ? 4_000 : 60_000);
    // 0.5 in a release build, and 65 when each name looked for the end of all of them.
    expect(await cpuTimeOfShortCuts("a.graphql", `{\n  a(b: [${variables}])\n}\n`)).toBeLessThan(3);
  });

  test("an indentation that is too long for a string is not written", async () => {
    expect(await memoryInMegabytes("a.graphql", "{a{b}}\n", ["--tab-width=4294967295"])).toBeLessThan(2000);
  });
});

/** How much longer it takes to format `text` with the short cuts than without them: the CPU time of the one by that of the other. */
async function slowdownByShortCuts(name: string, text: string) {
  using dir = tempDir("format-short-cuts", { [name]: text });
  const cpu = async (own: string[]) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fmt", "--check", "--no-config", "--no-editorconfig", "--log-level=silent", ...own, name],
      cwd: String(dir),
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;
    // (Windows counts in ticks of 1/64 s)
    return Math.max(Number(proc.resourceUsage()?.cpuTime.total ?? 0) / 1e6, 1 / 64);
  };
  return (await cpu([])) / (await cpu(["--no-short-cuts"]));
}

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
    '```js\nconst  a = 1\n```\n\n```\nplain\n```\n\n```unknown meta  data\n  kept  \n```\n\n```ts title="a"\nlet  b\n```\n',
    "```\n```\n\n```\n\n```\n\n``` js\na\n```\n\n```js \na\n```\n\n````md\n```js\na\n```\n````\n\n~~~\na\n~~~\n",
    "```js\na\n ```\n\n```js\na\n```  \n\n```js\n`` ``` ``\n```\n\n```a`b\n```\n\n```a\\b &amp;\nc\n```\n\n```js\nnot closed\n",
    '```css\na{b:c}\n```\n\n```json\n{"a":1}\n```\n\n```yaml\na:   1\n```\n\n```html\n<p>a</p>\n```\n\n```js\nsyntax error (\n```\n',
    // Emphasis, and what only looks like it.
    "*a* and _b_ and *two words* and (*c*) and *d*.\n\na*b*c and a_b_c and snake_case_name and _open and 2 * 3 and *.txt\n",
    "**a** and __b__ and **a_b** and **a\\*b** and ***c*** and **a* b and *a** b\n\n_a_ _b_ and *a*_b_ and _a *b* c_ and _a_b and a_ b_\n",
    "_[a](b)_ and [_a_](b) and [*a*](b) and [**a**](b) and ~~a~~ and ~a~ and ~~~a\n",
    "**a\u2028** b and **\u2029a** b and **\u00a0a** and **中文**中文 and 中文**中文**\n",
    "**a\u00a0** b** and **a \u3000** b** and **\u2003a** b and **a\u200b** b** and **a\ufeff** b** and **a \u0085** b**\n",
    "e\n*http://a\n\ne\n*a*\n\ne\n**a**\n\ne\n* a\n",
    // HTML and code that nothing ends, in a list, take the line break with them if a container follows.
    "- <!--\n> a\n",
    "- <!--\n# a\n",
    "- <!--\n\n> a\n",
    "- ```\n> a\n",
    "1. - <?\n> a\n\n> b\n",
    // Code spans.
    "`a` and `` a`b `` and `` `a` `` and ` a ` and `  ` and ` a` and ``a`` and `a\nb` and `not closed\n",
    "`a {{ b` }} *c* `d` and {{ a ` b }} *c* ` d\n",
    // Links, images, references.
    '[a](b) [a](<b c>) [a](b "c") [a](b \'c\') [a](b (c)) [a](b "c\'d") [a]() [a](b(c)d) [a](b\\)c) [a](b&amp;c) [a](b&c)\n',
    "[a] [a][b] [a][] [a]: b [^a] [[a]] ![a](b) ![a] ![a][b] [![a](b)](c) [a [b](c)](d) a] b [c\n\n[a]: d\n",
    "[a][b\\_c] [a][d&amp;e] [a][f\u00a0g] [a][\u3000h] [a][i\\(j] [a][k&l] [a][\u00e9]\n\n[b\\_c]: u\n[d&amp;e]: u\n[f\u00a0g]: u\n[\u3000h]: u\n[i\\(j]: u\n[k&l]: u\n[\u00e9]: u\n",
    "[b\\_c][] [b\\_c] [d&amp;e][] [d&amp;e] [a][b\\_c][b\\_c] **[a][d&amp;e]**\n\n| [a][d&amp;e] |\n| --- |\n\n[b\\_c]: u\n[d&amp;e]: u\n",
    "[a][b`c] ``d`` [a][b`c]\n\n[a][b<c] (*d*) e>\n\n[a][b{{c] (*d*) }}\n\n[b`c]: u\n[b<c]: u\n[b{{c]: u\n",
    "[a][b`c] ``d`` [a][b`c]\n\n[a][b<c] (*d*) e>\n\n[a][b{{c] (*d*) }}\n",
    "[a][](*b*) and [a][c](*b*) and [a][c][d](*b*) and [a] [c](*b*)\n\n[a]: u\n[c]: u\n[d]: u\n",
    "[a][](*b*) and [a][c](*b*) and [a][c][d](*b*) and [a](u)[c](*b*)\n",
    "[`]:`]\n",
    "[b`c]:  `d]\n\n[b`c]: u\n",
    "[<a]: b>]\n\n[<a b=']: c'>]\n\n[a `]` b](c) and [a <b c=']'> d](e)\n",
    "![`[`](u) ![`]`](u) ![a `[` b](u) ![`[]`](u) ![<a b='['>](u) ![<a b=']'>](u) ![{{ [ }}](u) ![a\\]](u) ![\\[](u) [![`[`](u)](v) [`[`](u)\n",
    "\\[a] and \\[[a](b)] and \\[[a]] and a\\\nb and \\_a\\_ and a\\",
    "[a\nb](c) and [a](b\nc)\n\n[*a*]\n\n[*a*]: b\n",
    // Addresses.
    "See http://a.b/c_d, https://a.b/c?d=e&f#g (http://a.b/c) and www.a.b and WWW.A.B and a@b.c and a_b@c.d.\n",
    "http://a.b/*c* and http://a.b/_c_ and http://a.b`c` and http://a.b[c] and [http://a.b](http://a.b) and now. www\n",
    "**a http://b_c.d e** and **a \u00e9http://b_c.d e** and **a xhttp://b_c.d e**\n",
    "http://a\u4e2d(*b* and www.a\u4e2d(*b*\n\nhttp://a\"(*b* and http://a'(*b*\n\nhttp://a](*b*\n\nhttp://a|(*b*\n\nhttp://a>(*b* and http://a}(*b* and http://a^(*b*\n",
    "**<http://a.b/[[c>]]**\n\n**<a:[[>]] b**\n\n<http://a.b/[[c>]]\n\n**<a b='[['>]]**\n\n**`[[`]]**\n",
    '<http://a.b> <a@b.c> <a b> <a> </a> <a b="c*d*"> <a\nb> < a <= b <1@b.c> <!-- c --> <?php ?> <br/> a<b>c\n',
    // What a line of a paragraph starts with.
    "a\n1. b\n\na\n2. b\n\na\n1986. b\n\na\n1986 b\n\na\n- b\n\na\n-b\n\na\n+ b\n\na\n# b\n\na\n#b\n\na\n> b\n\na\n=\n\na\n-\n\na\n---\n",
    "a\n```\nb\n```\n\na\n```b`c\n\na\n~~~\nb\n~~~\n\na\n$$\nb\n$$\n\na\n<div>\n\na\n<b>\n\na\n<b>\n:\n\na\n:::\n\na\n:-\n\na\n| b |\n\na | b\n- | -\n",
    "a\n b\n  c\n    d\n\ta\n\na\n    {{}}\n\na\n    - b\n",
    "}\n>2. a\n\n}\n>1. a\n\n}\n- 2. a\n",
    ":::tip\na\n:::\n\n::: a\n\nb\n\n:::\n",
    // Liquid.
    "{{ a }}\n\n{% b %}\n{{ c }}\ntext\n{{ d }}\n# e\n{{ f }}\n<div>\n</div>\n{{ g }}\n\n{{ h }} \n# i\n\n{{ j\n}}\n\n{{ k }} l {{ m }}\n",
    "n\n{{}}\n#\n\n{{}}\nn\n-\n\n{{}}\n|\n\n{{}}\n>\n\n{{}}\n~\n\n{{}}\ni  \n",
    "[a]({{ 'b') {{ c }}\n\n[a]({% (b)){% c %}\n\n[a]({{ \"b\") }}\n\n[a]({{) }}\n\n[a]({{ ) }}\n\n[a]({{b}} 'c')\n\n[a]({{b}})\n\n[a]({{\n'b') }}\n\n| [a]({{ (b)) {{ c }} |\n| --- |\n",
    "[a]({{b) *c* }}\n\n[a]({{b}}/c_d) *e*\n\n[a]({{b}}&amp;) }}\n\n[a]({{b}}(c)) }}\n\n[a]({{b}}\\)) }}\n\n[a]({%b%}) and [a]({{b}}{{c}}) and ![a]({{b}})\n",
    "[a][{%]  %}]\n\n[][{{]  }}]\n\n[{%]  %}]\n\n[{%]: u\n[{{]: u\n",
    "[a {{ b ] }} c   d](e)\n\n[{{ a }}]({{ b }})\n\n![{{ a ] }}](b)\n",
    '[a]({{ b }}) and [a]({{< b "c" >}}) and ![a]({{ b }}) and [a](b{{ c }})\n',
    // HTML.
    '<div>\n  <p>*a*</p>  \n\n</div>\n\n<img src="a">\n\n<img src="a"> b\n\n<span>a</span> *b*\n\n<my-element>\n\n<p-a>\n\n</div>\n  \n<div>\n',
    '<!-- a -->\n\n<!-- a\nb -->\n\n<!-- a --> b\n\n<!-->\n<n s="">\n\n<!-- a -->\n<div>\n\n<style>\n\na {}\n</style>\n\n<pre>\n\n</pre>\n',
    '<g s="">\n\ufeff',
    "<div>\n\u00a0\n",
    // Comments that tell the printer to leave something alone.
    "<!-- prettier-ignore -->\n| a | b |\n|--|--|\n\n| a | b |\n|--|--|\n",
    "<!--prettier-ignore-->\ns\n\n\ne\n\n<!--prettier-ignore-->\n# N\ns\n\n<!--prettier-ignore-->\n*a*  b\n- s\n",
    "<!-- prettier-ignore-start -->\n*a*\n\n| a |\n|-|\n<!-- prettier-ignore-end -->\n\n*b*\n",
    // Only the block behind such a comment is left to the parser. One that says something else is like any other.
    "<!-- prettier-ignore -->\n\n*a*  b\n\n*c*  d\n\n* e\n\n<!-- prettier-ignore -->\n* f\n\n* g\n\n*h*\n",
    "<!--\nprettier-ignore\n-->\n*a*  b\n\n*c*\n\n<!--\u00a0prettier-ignore\u00a0-->\n*a*  b\n\n*c*\n\n<!--prettier-ignore\n\n-->\n\n\n*a*  b\n\n*c*\n",
    "<!-- prettier-ignore -->  \n*a*  b\n\n<!-- prettier-ignore --> c\n\n*a*  b\n\ntext prettier-ignore -->\n\n*a*  b\n\n- <!-- prettier-ignore -->\n\n*a*  b\n",
    "<!-- please ignore -->\n\n*a*\n\n* b\n\n<!-- eslint-disable ignore -->\n| a |\n|-|\n\n<!-- prettier-ignore-next -->\n\n*a*  b\n",
    "<!-- prettier-ignore-end -->\n\n*a*\n\n<!-- prettier-ignore-start -->\n\n*b*\n\n* c\n",
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
    '| a |\n|-|\n| *b* |\n| a  b |\n| a\\|b |\n| a\\\\|b |\n| <br> |\n| <a b="|"> |\n| {{ c }} |\n| {{ c | d }} |\n| `a|b` |\n| [a](b) |\n| \ta |\n',
    "| a |\n|-|\n| b |\n{{ c }}\n\n| a |\n|-|\n  \ntext\n",
    "|||||\n|-|-|-|-|\n|||||\n",
    // The row under the header is as long as it's printed, with a space where a dash belongs.
    "| a   |\n| --  |\n| b   |\n\n| a   |\n|  -- |\n| b   |\n\n| a   | b   |\n| :-- | --  |\n| c   | d   |\n\n| a    |\n| - -- |\n| b    |\n\n| a   |\n| :-  |\n| b   |\n",
    // As many bytes as an aligned table has, and fewer columns.
    "| b       |\n| ------- |\n| \u2014     |\n| default |\n\n| b       |\n| ------- |\n| \u2014       |\n| default |\n\n| \u4e2d\u6587 |\n| ---- |\n| a    |\n\n| \u4e2d\u6587 |\n| ------ |\n| a      |\n",
  ];
  expectSame("a.md", texts, markdownOptions);

  // 0.15 in a release build and 0.5 in a debug build, which takes long to start. 1 and more when all of the text was parsed on
  // account of a comment.
  test.skipIf(!hasFlag)("a comment that says to leave a block alone is about that block", async () => {
    const blocks = "Some *text* with `code` and a [link](http://a.b/c).\n\n- item one\n- item two\n\n".repeat(
      isDebug || isASAN ? 4_000 : 8_000,
    );
    const text = `<!-- please ignore -->\n\n${blocks}<!-- prettier-ignore -->\n\n${blocks}`;
    expect(await slowdownByShortCuts("a.md", text)).toBeLessThan(0.8);
  });

  test.skipIf(!hasFlag).concurrent("bytes that aren't UTF-8", async () => {
    const inputs = [
      "**\xffw\xc2\xa0** q**\n",
      "**a \xff** b**\n",
      "**a \x80** b**\n",
      "**a **\x80 b**\n",
      "**a \xe4\xb8** b**\n",
      "**a \xe4\xb8\xad** b**\n",
      "**a \xffhttp://b_c.d e**\n",
      "a\xff_b\n",
      "| \xff   |\n| --- |\n| b   |\n",
      "# \xe2\x80\n\n- \xc3\n",
    ];
    using dir = tempDir("format-short-cuts", {});
    for (const input of inputs) {
      const [short, long] = await Promise.all(
        [[], ["--no-short-cuts"]].map(async own => {
          await using proc = Bun.spawn({
            cmd: [bunExe(), "fmt", "--no-config", "--no-editorconfig", "--stdin-filepath=a.md", ...own],
            cwd: String(dir),
            env: bunEnv,
            stdin: Buffer.from(input, "latin1"),
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);
          return { stdout: Buffer.from(stdout).toString("latin1"), stderr, exitCode };
        }),
      );
      expect({ input, ...short }).toEqual({ input, ...long });
    }
  });
});

describe("MDX", () => {
  const texts = [
    "---\ntitle: a\n---\n\n# Title\n\nA paragraph with `code`, a [link](/a/b) and **strong** words.\nIts second line.\n\n```ts\nlet  a\n```\n\n---\n\nThe end.\n",
    "import a from  'a'\nexport const b = 1\n\nimportant text\n\nexports\n\ntext\nimport c from 'c'\n",
    "{/* a */}\n\n{/* a */}\n```js\nb\n```\n\n{/* a */}\ntext\n\n{/*a*/}\n\n{/*  a  */}\n\n{/* a */} b\n\n{/* a */} b {/* c */}\n\n{/* é */}\n\n# {/* a */}\n",
    "{/* prettier-ignore */}\n| a | b |\n|--|--|\n\n{/* prettier-ignore */}\n*a*  b\n\n*c*\n",
    "{/* prettier-ignore */}\n\n*a*  b\n\n*c*  d\n\n* e\n\n{/* please ignore */}\n\n*a*\n\n<!-- prettier-ignore -->\n\n*a*  b\n\n*c*\n\ntext prettier-ignore */}\n\n*a*  b\n",
    '<A />\n\n<A>\n\ntext\n\n</A>\n\n<A b="c">\n  <B>\n\n<A>b</A>\n\n<A.B c>\n\n<a-b>\n\n<pre>\n\n<A>\n  \n</A>\n\n<A>\n<!-- b -->\n\n<A b={c}>\n\n<>\n\n<A>\u00a0\n',
    // JSX that's formatted already, and nearly so.
    '<Note>You cannot use both.</Note>\n\n<ParamField path="--config" type="string">\n  Specify path to config file (<code>bunfig.toml</code>). Alias: <code>-c</code>\n</ParamField>\n\n<ParamField path="--elide-lines" type="number" default="0">\n  Truncate each script\'s output to its last N lines when using --filter. Default 0 shows all lines\n</ParamField>\n',
    '<A b="c">\n  d\n</A>\n\n<A>\n  d\n</A>\n\n<A b="c" d>\n  e\n</A>\n\n<A b="c" d>e</A>\n\n<A b=\'c\'>d</A>\n\n<A b={c}>d</A>\n\n<A b="&quot;">d</A>\n\n<fbt>a</fbt>\n\n<A />\n\n<A/>\n\n<A b />\n\n<A>  d</A>\n\n<A>d  e</A>\n\n<A>{d}</A>\n\n<A>\u00e9</A>\n',
    "<A>\n  <code>a</code>\n</A>\n\n<A>\n  a <code>b</code>\n  c\n</A>\n\n<A>\n  a <code>b</code> c\n</A>\n\n<A>\n  a<code>b</code> c\n</A>\n\n<A>\n  a <br /> c\n</A>\n\n<A>\n    a\n</A>\n\n<A>\n\ta\n</A>\n\n<A>\n  a\n  b\n</A>\n\n<A>\n</A>\n\n<A>\n  a\n</B>\n",
    `<A>\n  ${"word ".repeat(15)}word\n  ${"word ".repeat(3)}word\n</A>\n\n<A>\n  ${"word ".repeat(14)}word\n  ${"word ".repeat(3)}word\n</A>\n\n<A>${"word ".repeat(14)}word</A>\n\n<A>${"word ".repeat(15)}word</A>\n\n<A b="${"c".repeat(90)}">\n  d\n</A>\n`,
    'a <b>c</b> d <br/> e < f <= g <A b="*c*" /> *h*\n\na {b} c {{ d }} e {% f %} g { h } i {/* j */}\n',
    "_a_ and *a* and _two words_ and a_b and a_b_ c and _a and snake_case `a_` and __a__\n\n**a** and **a b** and ** a** and **a **  and **a*b** and **`a*b`** and **a_b** and **[a](b)** and ***a***\n",
    "**a **: b\n\n**a & ** b\n\n**a\u00a0** b\n\n- **a **: b\n\n**a\u00e9** b\n\n| **a ** |\n| - |\n",
    "| [a  ](b) |\n| --- |\n| c |\n\n| a |\n| --- |\n| [b c  ](d). |\n\n| [a ](b) |\n| --- |\n\n| [  a](b) |\n| --- |\n\n| [ a](b) |\n| --- |\n\n[a  ](b) and [a ](b) and [  a](b)\n",
    '[a](b) and [a](b "c") and [a] and [a][b] and ![a](b) and [`a`](b) and [a](é) and [a\\]](b) and a] b\n\n[a](b)\n\n[a]: b\n',
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
  expectSame("a.mdx", texts, [
    ...markdownOptions,
    ["--print-width=40"],
    ["--jsx-single-quote"],
    ["--single-attribute-per-line"],
    ["--bracket-same-line"],
    // For what is in JSX, `import` and `export`, which is handed to JavaScript unless it's formatted already.
    ["--no-semi"],
    ["--no-bracket-spacing"],
    ["--quote-props=consistent"],
    ["--trailing-comma=none"],
    ["--arrow-parens=avoid"],
    ["--object-wrap=collapse"],
    ["--experimental-ternaries"],
    ["--experimental-operator-position=start"],
    ["--html-whitespace-sensitivity=ignore"],
    ["--vue-indent-script-and-style"],
  ]);

  // JavaScript says that its result is too long for a string, and the element stays as it is.
  describe("a level of indentation that is longer than a string can be", () =>
    expectSame(
      "a.mdx",
      [`<A>\n  ${"word ".repeat(30)}word\n</A>\n`, '<A b="c" d>\n  e   f\n</A>\n\n<A>\n  a   <code>b</code>\n</A>\n'],
      [
        ["--tab-width=600000000"],
        ["--tab-width=4294967295", "--print-width=30"],
        ["--tab-width=600000000", "--use-tabs"],
      ],
    ));

  // 0.5 in a release build, and 500 when every `_` looked at all of the word.
  test.skipIf(!hasFlag)("a word with many `_` is looked at once", async () => {
    const text = `${"foo_bar_baz,".repeat(isDebug || isASAN ? 6_000 : 24_000)}\n`;
    expect(await slowdownByShortCuts("a.mdx", text)).toBeLessThan(4);
  });

  // What is formatted already isn't as it's printed if its classes are sorted.
  test.skipIf(!hasFlag).concurrent("with prettier-plugin-tailwindcss", async () => {
    const plugin = "prettier-plugin-tailwindcss";
    const files = {
      "node_modules/tailwindcss/package.json": `{ "name": "tailwindcss", "version": "4.0.0", "main": "index.js" }`,
      "node_modules/tailwindcss/theme.css": "",
      "node_modules/tailwindcss/index.js": `const order = ["flex", "p-4"];
exports.__unstable__loadDesignSystem = async () => ({
  getClassOrder: classes => classes.map(name => [name, order.includes(name) ? BigInt(order.indexOf(name)) : null]),
});
`,
      [`node_modules/${plugin}/package.json`]: `{ "name": "${plugin}", "type": "module", "exports": "./index.mjs" }`,
      [`node_modules/${plugin}/index.mjs`]: "export const options = {};\nexport const parsers = {};\n",
      ".prettierrc": `{ "plugins": ["${plugin}"] }`,
      "a.mdx":
        '<a className="p-4 flex" />\n\n<A className="p-4 flex">b</A>\n\n<A className="p-4 flex">\n  <code className="p-4 flex">b</code>\n</A>\n\n' +
        '<A className="p-4 flex">\n\nb\n\n</A>\n\nexport const c = <a className="p-4 flex" />;\n\n```jsx\n<a className="p-4 flex" />;\n```\n',
      "a.md":
        '<a class="p-4 flex"></a>\n\nb <a class="p-4 flex">c</a>\n\n```jsx\n<a className="p-4 flex" />;\n```\n\n```html\n<a class="p-4 flex"></a>\n```\n',
    };
    const [short, long] = await Promise.all(
      [[], ["--no-short-cuts"]].map(async own => {
        using dir = tempDir("format-short-cuts", files);
        await using proc = Bun.spawn({
          cmd: [bunExe(), "fmt", "--write", "--log-level=warn", ...own, "a.mdx", "a.md"],
          cwd: String(dir),
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        const [mdx, md] = ["a.mdx", "a.md"].map(name => readFileSync(join(String(dir), name), "utf8"));
        return { mdx, md, stdout, stderr, exitCode };
      }),
    );
    expect(short).toEqual(long);
    expect(short.mdx).toStartWith('<a className="flex p-4" />\n\n<A className="flex p-4">b</A>\n');
    expect(short.exitCode).toBe(0);
  });
});

describe.skipIf(!hasFlag)("style sheets", () => {
  // Each of these was printed in another way by a short cut once, or is next to something that was.
  const cases: Record<string, string> = {
    "custom-property-with-brace.css": "--a:e{",
    "custom-property-with-brace.less": "--@{b}@{a}:w{",
    "custom-property-with-blank-and-brace.css": "--a:b {",
    "custom-property-with-blank-and-brace.scss": "c {\n  --a:b(d) e {\n  }\n}\n",
    "grid.css":
      "a {\n  grid-template-columns: min-content auto min-content min-content auto auto min-content;\n  grid: a b;\n}\n",
    "sign-and-interpolation.scss": "e{y: -#{a},n}\n$A: -#{a},o;\nf{y: -a,n}\n",
    "string-of-dots.scss": 'm:2 * "...",$a;\nn: 2 + "~";\no: "~" a;\n',
    "forward.scss": "@forward 'e' as y;\n",
    "forward-star.scss": "@forward 'e' as y-* show a, b;\n@use 'a' as *;\n@use 'b' as c;\n",
    "dash-after-interpolation.scss":
      "a{@return ( //\n'': (pget($deps,'mlarge-size') #{'/'}- map.get('label-lys-tlabel-large-font')));}\n",
    "comment-with-quote.less": '//\'\n\nl{o{a:b}}\n//*\n\nr{a:b}\n// "c"\na{b:c}\n',
    "empty-parentheses.scss": "@use ();\n@import ();\na{@use\n();}\n@include a();\n@if () {\n}\n",
    "variable-variable.less": "a:@@a,p;\n@A: l,@@a;\nb: @@a;\nc: -@a;\nd: @a @B @c;\n",
    "important.scss": "e:m,x != important;\nf: a ! important;\ng: a !important;\nh: a!important;\ni: important;\n",
    "next-to-it.scss":
      "a {\n  b: c; /* d */\n  e: f; // g\n  h: i;;\n  j {\n  } /* k */\n  @if $l {\n  } @else {\n    m: n;\n  }\n  o: p\n}\n",
    "ignore.scss":
      "a {\n  // prettier-ignore\n  b:   c;\n  /* prettier-ignore */\n  d   {e:f}\n  /*\n prettier-ignore */\n  g:   h;\n  i:   j;\n}\n",
    "empty-lines.css": "a {\n\n  b: c;\n\n\n  d: e;\n  \n  f {\n\n  }\n\n}\n\n\ng {\n}\n",
    "white-space.css": "a {\r  b: c;\f  d: e;\n\tf: g;\n  h: i ;\n  j : k;\n  l:m;n:o\n}\n",
    "map.scss":
      "$a: (\n  // b\n  c: d,\n\n  e: f(g, h),\n  i: (j: k, l: m),\n  n: o p q // r\n);\n@return (a: b, c: d);\n@include e((f: g));\n$h: (i, j);\n",
    "long.scss":
      "a {\n  b: some-function($some-argument, $another-argument, some-other-function($yet-another-argument, 10px));\n" +
      "  @include some-mixin($some-argument, $another-argument, $yet-another-argument, $one-more-argument);\n" +
      "  transition: opacity 0.3s ease, transform 0.3s ease;\n  font-family: a, b, c;\n  will-change: a, -b;\n}\n",
    "selectors.scss":
      "a,b{}\n.c > .d+.e ~ f{}\n&-g, &__h:hover::before{}\n[i='j'] &{}\n.k:not(.l, .m):nth-child(2n + 1){}\n#{$n}-o .p-#{$q}{}\n%r{}\n" +
      ".some-long-selector .another-long-selector > .yet-another-long-selector ~ .one-more-long-selector:hover{}\n",
    "selectors.less":
      ".@{a}-b, .c-@{d}{}\n.e() {}\n.f(@g, 1px) {}\n& when (@h = i) {}\n.j when (default()) and (@k > 1) {}\n.l;\n.m();\n.n(@o, 'p');\n.q(@r; @s);\n",
    "keyframes.css":
      "@keyframes a {\n  from {\n  }\n  50%, 75.5% {\n  }\n  TO {\n  }\n}\n@media (min-width: 100px) and (max-width: 200px), print {\n  A {\n  }\n}\n",
    "at-rules-by-name.scss":
      "@nest a {\n  b, c {\n  }\n}\n@utility a-* {\n  b: c * d;\n}\n@supports not (a: b) {\n  c: not(d);\n}\n@font-face {\n  a: b;\n}\n@charset 'a';\n",
    "control-directives.scss":
      "@if $a == b and not $c {\n  d: some-long-name another-long-name yet-another-long-name one-more-long-name and-one-more;\n} @else if ($e) {\n} @else {\n}\n" +
      "@each $f, $g in $h {\n}\n@for $i from 1 through 3 {\n}\n@while $j > 0 {\n}\n",
    "nested-properties.scss":
      "a {\n  font: {\n    family: b, c d;\n    @include e(f g);\n  }\n  font: bold {\n    size: 1px;\n  }\n}\n",
    "urls.scss":
      "a {\n  b: url(c.png);\n  d: url('e f.png');\n  g: url(http://h/i);\n  j: k(url(http://l));\n  url: m;\n  n: url;\n  o: (p);\n  q: urls(r);\n}\n",
    "interpolation-behind-url.scss":
      "a {\n  b: url(c)#{$d};\n  e: (url(c)#{$d} f);\n  g: url('c')#{$d};\n  h: i#{$d};\n  j: k(l)#{$d};\n}\n",
    "numbers.css":
      "a {\n  b: .5em 1.0px 1.50% 10PX 1e3 1E3 +1 -1 -.5 1hz 1q 007 1.;\n  c: #FFF #abc #ABCDEF;\n  d: INHERIT Initial auto;\n}\n",
    "strings.css": "a {\n  b: 'c' \"d\" 'e\"f' \"g'h\";\n  i: 'j';\n  k: \"l'm\" 'n';\n  --o: 'p' \"q\";\n}\n",
    "not-ascii.scss": "a {\n  b: 'é';\n  c: é;\n  // é  \n  /* 日本 */\n  d: e; \n  f: g;\n}\n.é {\n}\n",
    "bom.css": "﻿a {\n  b: c;\n}\n",
    "crlf.scss": "a {\r\n  b: c;\r\n\r\n  $d: (\r\n    e: f,\r\n  );\r\n  /* g\r\n   h */\r\n}\r\n",
    "no-final-newline.less": "@a: b;\n.c {\n  d: @a\n}",
    "guards.less":
      "when (@b){}\nwhen~(){}\n.a when (@b) and (@c) {}\n.some-long-name when (@some-long-variable = some-long-value) {}\n",
    "slash-at-the-end.css": "a: b;\n/",
    // To the printer, a variable of Less and the call of a mixin are at-rules, with a name that can mean something.
    "names-of-at-rules.less":
      "a{@import: @url serif some-long-name;}\n@namespace: b serif some-long-name another-long-name yet-another-long-name one-more;\n" +
      "@NAMESPACE: b serif some-long-name another-long-name yet-another-long-name one-more;\n@utility: b * c;\n@forward: b as c-*;\n" +
      "@d: b as c-*;\n@e: 'f' as *;\ng: h;\n@else: ();\ni: j;\n.else(k);\nl: m;\n.else;\n.import(n);\n@media: o;\n",
    // The second one is written from the memo.
    "line-break-in-a-value.html": "<style>a{--b: \n;--b: \n;}</style>\n",
    "line-break-in-a-value.vue": "<style>--A: b c\n// d;</style>\n<style>--A: b c\n// d;</style>\n",
    "line-break-in-a-value.css": "a{--b: \n;--b: \n;--c: d\ne;--c: d\ne;}\n",
    // What `trim` of JavaScript takes for white space, where a comment ends.
    ...Object.fromEntries(
      [0x0b, 0x0c, 0x0d, 0x09, 0xa0, 0xfeff, 0x2028, 0x2029, 0x3000].flatMap(code => {
        const space = String.fromCodePoint(code);
        const inBlock = `{\n  //${space}\n  a: b;\n  // c${space}\n  /*${space}*/\n  /* d${space}*/\n  //${space}\n}\n`;
        const inMap = `$e: (\n  //${space}\n  f: g,\n  // h${space}\n  i: j // k${space}\n);\n`;
        return [
          [
            `comments-${code}.scss`,
            `//${space}\n// l${space}\n//${space}m\n/*${space}*/\n/* n${space}*/\no ${inBlock}${inMap}`,
          ],
          [
            `comments-${code}.less`,
            `//${space}\n// l${space}\n//${space}m\n/*${space}*/\n/* n${space}*/\no ${inBlock}`,
          ],
          [`comment-first-${code}.scss`, `//${space}\na{b:c}`],
          [`comment-last-${code}.scss`, `a{b:c}\n//${space}`],
          [`comment-alone-${code}.scss`, `//${space}`],
          [`comment-alone-${code}.css`, `/*${space}*/${space}`],
        ];
      }),
    ),
    "first-word.scss":
      "a{@include n,t ();\n@include n, t ();\n@include n ();\n@include n (o);\n@if ($a) and ($b) {}\n@if $a,b ($c) {}\n}\n",
    "ignore-and-quote.less": "//prettier-ignore'\nf:   g;\n// prettier-ignore *\nh:   i;\n",
    "evaluated.less":
      "r:~`o('',) `;\n@a: color(~`colorPalette('@{b}', 1) `);\n@c: mix(color(~`d(\"@{e}\", 2) `), @f, 10%);\n",
    "keys-with-a-sign.scss":
      "$e:(-4: x);\n$f: (0: a, -1: b);\n@function g() {\n  @return (t((-3: 4)));\n  @return ();\n}\n",
    "sign-and-variable.less": "a{t:-@i,h}\nb{t:-@i}\n",
    "global.scss": "$a: b !global;\n$c: (d: e) !global;\n$f: g !default !global;\nh: i !global;\n",
    "parentheses.less":
      "a {\n  padding: 0 (@b / 2);\n  margin: -(@c / 2);\n  top: (@d + 1) * 2;\n}\n@e: 1px + (@f / 2);\n",
    "standing.scss":
      '@use "a";\n@use "b" as c;\n\n// d\n$e: f;\n\n.g {\n  h: i;\n\n  /* j */\n  &-k,\n  .l > m:hover {\n    n: o(p, 1px) q;\n' +
      "    @include r;\n    @include s($t) {\n      u: v;\n    }\n  }\n  .#{$w}-x {\n  }\n\n  @media (min-width: 1px) {\n    y: z;\n  }\n" +
      "  @if $a {\n    b: c;\n  } @else {\n    d: e;\n  }\n}\n",
    "nearly-standing.scss":
      ".a {\n\n  b: c;\n   d: e;\n  f: g; // h\n  i: j;;\n  .k {\n    l: m;\n\n  }\n  .n {\n    o: p;\n  } /* q */\n  .r {\n    s: t\n  }\n" +
      "  .u {\n    // prettier-ignore\n    v:   w;\n  }\n" +
      "  x: some-long-name another-long-name yet-another-long-name one-more-long-name and-another-one;\n  .y  {\n  }\n  // z \n}\n",
    "standing.less":
      "@a: b;\n@C: @a 1px;\n\n// d\n.e {\n  .f;\n  .g();\n  .h(@a, 1px);\n  i: @a;\n  &-j .@{k}-l {\n    m: n;\n  }\n}\n",
    "standing-values.css":
      "a {\n  b: var(--c);\n  d: var(--e, var(--f)) --g;\n  h: translateY(0) currentColor optimizeLegibility;\n  i: Inherit;\n" +
      "  j: INITIAL k;\n  l: URL(m);\n  n: Url;\n  o: -Foo;\n  p: --q(r);\n  s: ---t;\n  u: --url;\n  v: --1;\n  w: --X;\n" +
      "  x: l(+10%) f(+1 2) f(a, +1) f(+.5) f(+1.50) f( +1) f(+ 1) f(+a);\n  y: +1;\n  --z: A, b c, -d;\n}\n",
    "standing-values.scss":
      "a {\n  b: var(--c) $D fooBar($e);\n  @include fooBar(--f, Bar);\n  @if $g == Bar {\n    h: l(+10%);\n  }\n  $I: Unset;\n}\n",
    "standing-values.less": "@a: var(--b) Bar;\n.c {\n  .d(--e, Bar);\n  f: @G l(+10%) fooBar(@a);\n  g: Revert;\n}\n",
    "standing-lists.css":
      "a {\n  b: c, d, e;\n  b: c, -d;\n  b: -c, d;\n  b: c d, e f;\n  b:\n    c d,\n    e f;\n  b:\n    c d,\n    e;\n  b:\n    c,\n    d;\n" +
      "  b:\n    c d, e f;\n  b:\n    c d,\n    -e;\n  b:\n    -c,\n    d e;\n  b:\n    c d;\n  b:\n    c;\n  b:\n    c d,\n\n    e f;\n" +
      "  b:\n   c d,\n    e f;\n  b:\n    c d,\n    e f !important;\n  b:\n    c d,\n    e f; /* g */\n  b:\n    1px/2 c,\n    d e;\n" +
      "  b:\n    c d,\n    e important;\n  grid-template-columns: c, d;\n  grid-template-columns:\n    c d,\n    e f;\n" +
      "  composes:\n    c d,\n    e f;\n  --b:\n    c d,\n    e f;\n" +
      "  b:\n    some-long-name, another-long-name, yet-another-long-name, one-more-long-name,\n    and-another-one;\n" +
      "  b:\n    some-long-name, another-long-name, yet-another-long-name,\n    one-more-long-name, and-another-one;\n" +
      "  b:\n    some-long-name, another-long-name, yet-another-long-name, one-more-long-nam;\n" +
      "  b:\n    some-long-name, another-long-name, yet-another-long-name, one-more-long-na;\n" +
      "  b:\n    some-long-name, another-long-name, yet-another-long-name, one-more-long-name,\n    -and-another-one;\n" +
      "  b:\n    some-long-name another-long-name yet-another-long-name one-more-long-name aa,\n    c;\n" +
      "  b:\n    some-long-name another-long-name yet-another-long-name one-more-long-name a,\n    c;\n}\n",
    "standing-lists.scss":
      "$a:\n  b c,\n  d e !default;\n@if $f {\n  g:\n    b c,\n    d e;\n  g: b, c;\n}\nh {\n  font: {\n    family:\n      b c,\n      d e;\n  }\n}\n",
    "standing-lists.less":
      "@a:\n  b c,\n  d e;\n@f: b, c;\ng {\n  h:\n    @@i,\n    j;\n  h: @@i, j;\n  h:\n    @a b,\n    c;\n}\n",
    "standing-lists.html": "<style>\n  a {\n    b: c, d;\n    b:\n      c d,\n      e f;\n  }\n</style>\n",
    "standing-selectors.css":
      "a[b=\"c\"]::before {\n}\na[b='c'] {\n}\n.d:not(.e):not([f]) > * {\n}\n* + [g] {\n}\n:is(.h, .i) .j:nth-child(2n + 1) {\n}\n#Kl .mN {\n}\n" +
      "@media (min-width: 1px) {\n  #Kl {\n  }\n  .o:not(.p) {\n  }\n}\n@keyframes q {\n  from {\n  }\n  12.5%,\n  50% {\n  }\n  TO {\n  }\n}\n" +
      ".some-long-selector\n  .another-long-selector\n  > .yet-another-long-selector\n  ~ .one-more-long-selector:hover {\n}\n" +
      ".some-long-selector\n  .another-long-selector {\n}\n.some-long-selector .another-long-selector\n  > .yet-another-long-selector\n  ~ .one-more-long-selector:hover {\n}\n" +
      ".some-long-selector\n  .another-long-selector\n  > .yet-another-long-selector\n  ~ .one-more-long-selector:hover,\n.r {\n}\n" +
      ".some-long-selector:not(.another-long-selector):not(.yet-another-long-selector):not(.s)\n  .one-more-long-selector {\n}\n" +
      ".some-long-selector\n   .another-long-selector\n  > .yet-another-long-selector\n  ~ .one-more-long-selector:hover {\n}\n",
    "standing-comments.scss":
      "/* a\n   b */\n\n/**\n * c\n */\nd {\n  /*\n    e\n  */\n  f: g; /* h */\n  i: j; // k\n  l: m n; /* o */ /* p */\n  q: r; /* s\n  t */\n" +
      "  u: v; /* prettier-ignore */\n  w:   x;\n  y: z; // prettier-ignore\n  a:   b;\n  /*\n  prettier-ignore */\n  c:   d;\n  e: f;  /* g */\n  h: i;/* j */\n" +
      "  k: some-long-name another-long-name yet-another-long-name one-more-long; /* l */\n" +
      "  k: some-long-name another-long-name yet-another-long-name one-more-long; /* lm */\n" +
      "  some-long-name-another-long-name-yet-another-long-name: one-more-long-name; /* and-another-one */\n  @include m; // n\n}\n",
    "standing-comments.less":
      ".a {\n  b: c; // d\n  .e; // f\n  .g(); /* h */\n  @i: j; // k\n  /* l\n  m */\n  n: o; // 'p'\n  q: r; // (s\n}\n",
    "standing-comments.md": "```css\n/* a\n   b */\nc {\n  d: e; /* f */\n}\n```\n",
    "standing-at-rules.css":
      '@import "a.css";\n@import "b.css" screen;\n@import \'c.css\';\n@import url(d.css);\n@import "e", "f";\n@IMPORT "g";\n' +
      "@keyframes h {\n}\n@-webkit-keyframes I-j {\n}\n@keyframes url {\n}\n@keyframes k  {\n}\n@keyframes 'l' {\n}\n",
    // A style sheet that's written as it's printed is copied as a whole.
    "whole.css": "a {\n  b: c;\n}\n",
    "whole-without-final-newline.css": "a {\n  b: c;\n}",
    "whole-between-empty-lines.css": "\n\na {\n  b: c;\n}\n\n\n",
    "whole-before-blanks.css": "a {\n  b: c;\n}\n  \t\n",
    "whole-after-blanks.css": "  a {\n  b: c;\n}\n",
    "whole-before-form-feed.css": "a {\n  b: c;\n}\n\f",
    "whole-before-no-break-space.css": "a {\n  b: c;\n}\n\u00a0",
    "whole-after-bom.css": "\ufeffa {\n  b: c;\n}\n",
    "whole-with-crlf.css": "a {\r\n  b: c;\r\n}\r\n",
    "whole-with-one-cr.css": "a {\n  b: c;\r}\n",
    "whole-but-unclosed.css": "a {\n  b: c;\n",
    "whole-but-closed-twice.css": "a {\n  b: c;\n}\n}\n",
    "whole-but-for-the-last-line.css": "a {\n  b: c;\n}\nd {\n  e:f;\n}\n",
    "whole-after-front-matter.css": "---\na: b\n---\n\na {\n  b: c;\n}\n",
    "whole-like-front-matter.css": "---a {\n  b: c;\n}\n---d {\n}\n",
    "whole-with-pragma.css": "/** @format */\n\na {\n  b: c;\n}\n",
    "whole-with-quote-in-comment.less": "// 'a'\nb {\n  // c\n  d: e; // f\n  // \"g\"\n  h: i; // 'j'\n  /* k */\n}\n",
    "whole.md": "```css\na {\n  b: c;\n}\n```\n",
    "whole.html": "<style>\n  a {\n    b: c;\n  }\n</style>\n",
    ...Object.fromEntries(
      ["css", "scss", "less"].map(syntax => [
        `plain-at-rules.${syntax}`,
        "@layer a;\n@layer a, b-c;\n@layer a {\n  d {\n  }\n}\n@theme inline {\n  --a: b;\n}\ne {\n  @apply a b-c d/50 hover:e w-1.5;\n  @apply url;\n" +
          "  @apply hover:url;\n  @apply a  b;\n  @apply A;\n  @apply a !important;\n  @apply a[b];\n  @apply a, b;\n  @apply a;;\n  @apply a; /* f */\n}\n" +
          "@tailwind base;\n@layer a.b {\n}\n@layer  a;\n@LAYER a;\n@theme {\n}\n@layer a{}\n@theme a;\n@apply a {\n}\n@layer url;\n" +
          "e {\n  @apply some-long-name another-long-name yet-another-long-name one-more-long-name and-another-one;\n}\n",
      ]),
    ),
    ...Object.fromEntries(
      ["css", "scss", "less"].map(syntax => [
        `slash-between-names.${syntax}`,
        "a {\n  b: c/d;\n  b: c/d e;\n  b: c/d, e;\n  b: c/d/e;\n  b: c/1;\n  b: 1/c;\n  b: f(c/d);\n  b: c/url;\n  b: C/d;\n  b: c/D;\n  b: -c/d;\n  b: c /d;\n" +
          "  b: c.d/e;\n  grid-area: c/d;\n  grid-column: wide-start/wide-end;\n  --b: c/d;\n" +
          "  b: some-long-name/another-long-name yet-another-long-name one-more-long-name/and-another-one;\n}\n",
      ]),
    ),
    "escapes-in-strings.scss":
      'a {\n  b: "\\2014 \\00A0";\n  b: "\\f101" c;\n  b: \'\\e900\';\n  b: "\\"";\n  b: "\\\\";\n  b: "c\\\nd";\n  b: url("\\2014");\n  b: "\\#{c}";\n  b: "\\!";\n}\n',
    "strings-that-are-not-ascii.scss":
      'a {\n  b: "←";\n  b: "é" c;\n  b: "日本語", d;\n  b: e("é");\n  b:\n    "é" c,\n    d e;\n  @include f("é");\n' +
      '  b: some-long-name another-long-name yet-another-long-name "日本語日本語日本";\n' +
      '  b: some-long-name another-long-name yet-another-long-name "日本語日本語日本語";\n' +
      '  b: some-long-name, another-long-name, yet-another-long-name, "日本語日本語日";\n' +
      '  b:\n    some-long-name, another-long-name, yet-another-long-name, "日本語日本語日本語",\n    c;\n}\n',
    "numbers-of-every-length.css":
      "a {\n  b: 1 12 123 1234567 12345678 123456789 1px 123456px 1234567px 12345678px;\n  b: 1.5 1.25em 123.456 1234.567 12345.678px 1.2345678 0.5turn 1.5grad;\n" +
      "  b: 1% 1234567% 12345678% 1.5% 1.0 1.50 1. 1.px 1hz 1khz 1q 1Q 1x 1e3 1e 1.5e3 1abcdefg 1abcdefgh;\n  b: 1;\n}\nc {\n  d: 1",
    "parentheses-without-a-name.scss":
      "$a: ();\n$a: () !default;\n$a: (b, c);\n$a: (b c);\n$a: (b: c);\n$a: (b, (c, d));\n$a: (b, (c: d));\n$a: f((b, c));\n$a: (b), c;\n$a: (b) c;\n$a: ( );\n" +
      "e {\n  f: (1 + 2) * 3;\n  f: with (g);\n  f: -(g);\n  grid-area: (g);\n  --f: (g);\n  f: 1px/2 (g);\n  @include h((b, c));\n  @if (g) {\n  }\n" +
      "  f: (some-long-name, another-long-name, yet-another-long-name, one-more-long-nam);\n" +
      "  f: (some-long-name, another-long-name, yet-another-long-name, one-more-long-name);\n}\n",
    "interpolation.scss":
      "a {\n  b: var(--#{$c}d);\n  b: var(--#{$c}d-e, #{$f});\n  b: #{$c};\n  b: #{$c}-d#{e.$f};\n  b: c-#{$d} e;\n  b: $c#{$d};\n  b: 1#{$c};\n  b: #fff#{$c};\n" +
      "  b: C#{$d};\n  b: c.d#{$e};\n  b: f(c)#{$d};\n  b: #{$c}--;\n  b: #{c($d)};\n  b: #{$C};\n  b: #{ $c };\n  b: -#{$c};\n  b: #{$url};\n  --b: #{$c};\n" +
      "  b: var(--#{$c}d), var(--#{$c}e);\n  b:\n    var(--#{$c}d),\n    var(--#{$c}e);\n  b:\n    var(--#{$c}d) f,\n    var(--#{$c}e);\n  b: #{$c}, d;\n}\n",
    "use-and-content.scss":
      '@use "a" as *;\n@use "./b" as c;\n@use \'d\' as *;\n@use "e" as * ;\n@use "f"  as *;\n@forward "g" as *;\n@mixin h {\n  @content;\n  @content ;\n  @content();\n' +
      '  @include i as *;\n  @return "j" as *;\n  font: {\n    @content;\n  }\n}\n',
    "mixins-and-escapes.less":
      '.a(@b, @c) {\n  d: (@b / 2);\n  e: (@b + 1) * 2;\n  f: -(@b);\n  g: ~"@{h}-i";\n  j: ~\'k\';\n  l: m ~"n";\n  o: (p), q;\n  o: ~"p", q;\n  o:\n    ~"p",\n    q r;\n}\n' +
      '@w: ~"@{x}-y";\n@z: (1 + 2);\n.a(@b) when (@c) {\n}\n.a(@b: 1) {\n}\n.A(@b) {\n}\n.a(@b){}\n.a(@b)  {\n}\n.a((@b)) {\n}\n.else(@b) {\n}\n.a("é") {\n}\n.a(@b) { // c\n}\n',
    "standing-calls.scss": (() => {
      const [a, b, c] = ["$some-long-argument-name", "$another-long-argument-name", "yet-another-name($one-more)"];
      const call = (head: string, items: string[], tail: string, indent = "  ") =>
        `${indent}${head}(\n${items.map(it => `${indent}  ${it}`).join(",\n")}\n${indent})${tail}\n`;
      return (
        call("$d: some-module.some-function", [a, b, c], ";", "") +
        call("$d: e", [a, b, c], " !default;", "") +
        call("$d: e", ["f", "g"], ";", "") +
        "h {\n" +
        call("i: some-function", [a, b, c], ";") +
        call("i: some-function", [a, b, c], " !important;") +
        call("i: some-function", [a, b, c], "; // j") +
        call("i: some-function", [a, b, c], " k;") +
        call("i: k some-function", [a, b, c], ";") +
        call("i: -some-function", [a, b, c], ";") +
        call("i: someFunction", [a, b, c], ";") +
        call("i: some-function", [a, b, `${c},`], ";") +
        call("i: some-function", [`${a}, ${b}`, c], ";") +
        call("i: some-function", [a, `\n    ${b}`, c], ";") +
        call("i: some-function", [a, `// l\n    ${b}`, c], ";") +
        call("i: some-function", [`$m: ${a}`, b, c], ";") +
        call("i: some-function", [`(${a})`, b, c], ";") +
        call("i: some-function", [a, b, "url(http://some-long-host/some-long-path)"], ";") +
        call("i: some-function", [a, b, "1px/2", c], ";") +
        call("i: some-function", [`${a} ${b}`, c], ";") +
        call("i: some-function", [`${a} ${b} ${c} and-some-more-words`, c], ";") +
        call("i: some-function", [a, b, '"日本語日本語日本語"'], ";") +
        call("i: url", [a, b, c], ";") +
        call("i: not", [a, b, c], ";") +
        call("grid-area: some-function", [a, b, c], ";") +
        call("--i: some-function", [a, b, c], ";") +
        call("@include some-module.some-mixin", [a, b, c], ";") +
        call("@include some-mixin", [a, b, c], " {\n  }") +
        call("@include n", ["f", "g"], ";") +
        call("@return some-function", [a, b, c], ";") +
        call("@debug some-function", [a, b, c], ";") +
        call("@if some-function", [a, b, c], " {\n  }") +
        "  font: {\n" +
        call("family: some-function", [a, b, c], ";", "    ") +
        call("@include some-mixin", [a, b, c], ";", "    ") +
        "  }\n}\n"
      );
    })(),
    "standing-calls.less":
      "a {\n  b: some-function(\n    @some-long-argument-name,\n    @another-long-argument-name,\n    @yet-another-long-name\n  );\n" +
      "  .some-mixin(\n    @some-long-argument-name,\n    @another-long-argument-name,\n    @yet-another-long-name\n  );\n}\n" +
      "@c: some-function(\n  @some-long-argument-name,\n  @another-long-argument-name,\n  @yet-another-long-name\n);\n",
    "lists-of-custom-properties.css":
      'a {\n  --b:\n    ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, Consolas,\n    "Liberation Mono", monospace;\n' +
      '  --b:\n    ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",\n    Roboto, sans-serif;\n  --b:\n    c, d;\n  --b:\n    c;\n' +
      "  --b:\n    0 3px 1px -2px rgba(0, 0, 0, 0.2), 0 2px 2px 0 rgba(0, 0, 0, 0.14),\n    0 1px 5px 0 rgba(0, 0, 0, 0.12);\n" +
      "  --b:\n    0 3px 1px -2px rgba(0, 0, 0, 0.2),\n    0 2px 2px 0 rgba(0, 0, 0, 0.14),\n    0 1px 5px 0 rgba(0, 0, 0, 0.12);\n" +
      "  --b:\n    some-long-name, another-long-name, yet-another-long-name, one-more-long-name,\n    'c', \"d\", .5, 1.0, #FFF;\n" +
      "  --b:\n    some-long-name, another-long-name, yet-another-long-name, one-more-long-name,\n    c !important;\n" +
      "  --b:\n    some-long-name,another-long-name, yet-another-long-name, one-more-long-name,\n    c;\n" +
      "  --b:\n    some-long-name another-long-name yet-another-long-name one-more-long-name and,\n    c;\n}\n",
    "capitals-in-and-after-at-rules.css":
      "@media (min-width: 1px) {\n  A {\n  }\n}\nB {\n  @media (min-width: 1px) {\n    C {\n      D {\n      }\n    }\n  }\n  E {\n  }\n}\n" +
      "@keyframes f {\n  FROM {\n  }\n}\nFROM {\n}\n",
    "empty-line-behind-a-call-with-two-dashes.scss":
      "a{b:(1 --c(),\n\nd)}\ne{b:f(1 --c(),\n\nd)}\ng{b:(1 -c(),\n\nd)}\n",
    "empty-string-and-slashes-in-selectors.css":
      'a[alt=""], a[href^="http://"] {\n  e: f;\n}\na[alt=""],\na[href^="http://"] {\n  e: f;\n}\na[href^="http://"],\na[alt=""] {\n  e: f;\n}\n' +
      'a[alt=""] b[c="/*"] {\n  e: f;\n}\na[alt="/"],\na[c="/d/e"] {\n  e: f;\n}\na[href^="http://"] {\n  e: f;\n}\n',
    "empty-string-and-slashes-in-the-call-of-a-mixin.less":
      '.m(\'\', \'http://x\');\n.a {\n  .m("", "http://x");\n  .m("", "/*");\n  .m("http://x", "");\n  .m("http://x");\n  .m("") {\n  }\n}\n',
    "exponent-in-a-color-in-the-call-of-a-mixin.less":
      ".a {\n  .m(#31b0e0);\n  .m( #31b0e0 );\n  .m(#1e3);\n  .m(#1e03, #00e0ff);\n  .m(#e0e0e0, #a1e0, #3ae0, #000, #12ab34);\n  .m(#0e0) {\n  }\n  b: #31b0e0;\n}\n",
    "start-of-a-comment-in-a-url.css":
      "a {\n  b: url(img/*.png) no-repeat, url(c.png) repeat;\n  b: url(img/*.png)   no-repeat;\n  b: url(*/);\n  b: url(a/b*.png)  c;\n}\n",
    "url-behind-a-comma.css": "a{b:c,url(/*);d:e;f:url(*/)}\ng{b:c,url(d)}\n",
    "url-behind-a-comma.less": "a{b:c,url(/*);d:e;f:url(*/)}\ng{b:c,url(d)}\n",
    "url-behind-a-comma.scss": "a{b:c,url(/*);d:e;f:url(*/)}\ng{b:c,url(d)}\n",
    "bracket-in-a-url-behind-a-comma.css": "a{background:url(a.png),url(/i/[.png)}\n",
    "url-behind-an-interpolation.scss": 'a {\n  b: #{$c}url;\n  @if ($d == ")") {\n    e: f;\n  }\n}\n',
    "number-behind-an-interpolation.scss":
      "a {\n  b: #{$c}1e03 #{$c}1q;\n  b: #{$c}1.50;\n  b: #{$c}-1e03 #{$c}--1q;\n  b: #{$c}px #{$c}e03 #{$c}-a1e03 #{$c}_1;\n  b: a-#{$c}-1 a-#{$c}1;\n}\n",
    "url-in-a-guard.less": '.a when ((@a) = url) {\n  @x: (a")");\n}\n',
    "extend-in-a-string.less":
      'a {\n  content: "extend(b)";\n  content: "EXTEND(b)" c;\n  content: "extend (b)";\n  @d: "extend(b)";\n}\n',
    "dollar-and-dots-in-a-string.scss":
      '@include a("$b ...");\n@include a("$b  ...", $c...);\n@include a("$b", "...");\n@return "$b ...";\na {\n  c: "$b ...";\n  c: "$";\n}\n',
    "url-that-no-parenthesis-has-taken.css":
      "a{b:url}\n@media (min-width: 1px) {\n  c {\n    d: e;\n  }\n}\nf {\n  g: url h;\n  i: j;\n  k: ((l));\n  m: (n);\n  o: p;\n}\n",
    "url-that-no-parenthesis-has-taken.less":
      "// the url\n@media (min-width: 1px) {\n  c {\n    d: (e);\n  }\n}\n// the url of\n.a {\n  b: c;\n  .m((d));\n}\n@media (f: g) {\n  .h {\n    i: j;\n  }\n}\n",
    "url-that-no-parenthesis-has-taken.scss": "$a: url;\n$b: ((c: d));\n@include e((f));\n// url\n$g: (h: i);\n",
    "unclosed.css": "a {\n  b: c;\n  d {\n    e: f;\n",
    "closed-twice.css": "a {\n  b: c;\n}\n}\n",
    "empty.css": "",
    "blank.scss": " \n\t\n",
  };
  const sets = [
    [],
    ["--print-width=40"],
    ["--print-width=1"],
    ["--print-width=100000"],
    ["--tab-width=0"],
    ["--tab-width=5000", "--print-width=20000"],
    ["--tab-width=4294967295"],
    ["--use-tabs", "--tab-width=3"],
    ["--single-quote", "--trailing-comma=none"],
    ["--end-of-line=crlf"],
    ["--end-of-line=cr", "--print-width=30"],
    ["--end-of-line=auto"],
    ["--insert-pragma"],
    ["--require-pragma"],
    ["--range-start=3", "--range-end=9"],
  ];

  test.concurrent.each(sets.map(set => set.join(" ")))("with and without them: %s", async set => {
    const options = set.split(" ").filter(Boolean);
    const run = async (flags: string[]) => {
      const dir = tempDir("fmt-short-cuts", cases);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "fmt", "--write", "--no-config", "--no-editorconfig", "--threads=1", ...options, ...flags, "."],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const files = Object.fromEntries(
        Object.keys(cases).map(name => [name, readFileSync(join(String(dir), name), "latin1")]),
      );
      dir[Symbol.dispose]();
      const withoutTime = (text: string) => text.replace(/\[[\d.]+m?s\]/g, "");
      return { files, stdout: withoutTime(stdout), stderr: withoutTime(stderr), exitCode };
    };
    const [short, long] = await Promise.all([run([]), run(["--no-short-cuts"])]);
    expect(short).toEqual(long);
  });

  test.each(["a{b:c}\n", "a{b:c d,e f}\n", "a{b{}}\n"])(
    "an indentation that is too long for a string is not written: %j",
    async text => {
      expect(await memoryInMegabytes("a.css", text, ["--tab-width=4294967295"])).toBeLessThan(2000);
    },
  );

  test("a `url` in a comment of Less leaves the short cuts on", async () => {
    const rules = Array.from(
      { length: isDebug ? 5_000 : 50_000 },
      (_, index) => `.a${index} {\n  color: red;\n  margin: 0 auto;\n  padding: 1px 2px 3px ${index}px;\n}\n`,
    );
    // 0.16 in a release build, and 0.84 when all that follows the comment went the long way.
    expect(await cpuTimeOfShortCuts("a.less", `// the url of the font\n${rules.join("")}`)).toBeLessThan(0.6);
  });

  test("at-rules with many names take linear time", async () => {
    const count = isDebug ? 4_000 : 40_000;
    const text = Array.from({ length: count }, (_, index) => `@a${index}{b{c:d e}}\n`).join("");
    // 0.7 in a release build, and 24 when each at-rule was looked for among all that came before it.
    expect(await cpuTimeOfShortCuts("a.css", text)).toBeLessThan(4);
  });
});

/** Formats `files` with `options`, with and without short cuts, and returns what differs. */
async function difference(files: Record<string, string>, options: string[]) {
  const printed = await Promise.all(
    [[], ["--no-short-cuts"]].map(async own => {
      using dir = tempDir("format-short-cuts", files);
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "fmt",
          "--write",
          "--no-config",
          "--no-editorconfig",
          "--log-level=warn",
          ...options,
          ...own,
          ".",
        ],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const texts = readdirSync(String(dir)).map(name => [name, readFileSync(join(String(dir), name), "utf8")]);
      return { texts: Object.fromEntries(texts), stdout, stderr, exitCode };
    }),
  );
  return printed;
}

describe.skipIf(!hasFlag)("statements, declarations, classes and types", () => {
  const files = {
    // A comment in a body without braces can say to ignore the body, which then isn't certain to break.
    "ignored.js": `
      function a() {
        if (a) if (b); /* c */
        /* prettier-ignore */
        else return 2;
        if (a) if (b); // prettier-ignore
        else return 2;
        while (a) if (b) c(); /* prettier-ignore */ else d();
        for (;;) if (b) {
          c();
        } /* prettier-ignore */ else d();
        if (a) for (;;) { /* prettier-ignore */
        }
        if (a) b(() => {
          // prettier-ignore
          c( );
        });
        if (a) /* prettier-ignore */ b(() => {
          c( );
        });
        if (a) try { b() } /* prettier-ignore */ finally { c( ) }
        if (a) switch (b) { /* prettier-ignore */ case 1: c( ) }
        else switch (b) { /* prettier-ignore */ }
      }
    `,
    "statements.ts": `
      if (a) return;
      if (a) b(); else c();
      if (a) b(); else if (c) d(); else { e(); }
      if (a) {} else {}
      if (a); else b;
      if (a) if (b) c(); else d();
      if (someCondition) someFunction(function () { return 1; });
      if (someCondition) someFunction({
        a: 1 });
      if (someCondition && anotherCondition) return someFunction(argumentNumberOne, argumentNumberTwo);
      if (a) return "😈 not as wide as it has bytes, not as wide as it has bytes 😈😈😈😈";
      else throw someFunction(argumentNumberOne, argumentNumberTwo, argumentNumberThree);
      if (someCondition && anotherCondition && oneMoreCondition && yetAnotherCondition && theLastCondition) { a(); }
      if (someCondition || anotherCondition || oneMoreCondition(withArguments, andMore) || yetAnotherCondition) {}
      if (someCondition && anotherCondition || oneMoreCondition && yetAnotherCondition || theLastCondition1) { a(); }
      if (someCondition && (anotherCondition && oneMoreCondition) && yetAnotherCondition && theLastCondition) { a(); }
      if (someCondition && anotherCondition && oneMoreCondition && yetAnotherCondition && { a: 1, b: 2 }) { a(); }
      if (someCondition ?? anotherCondition ?? oneMoreCondition ?? yetAnotherCondition ?? theLastCondition12) { a(); }
      if (!(someCondition && anotherCondition && oneMoreCondition && yetAnotherCondition && theLastCondition)) { a(); }
      if (someFunction(argumentNumberOne, argumentNumberTwo, argumentNumberThree, argumentNumberFour, five)) { a(); }
      if (someValue + anotherValue + oneMoreValue > yetAnotherValue * theLastValue + andSomeMoreOfThemHere1) { a(); }
      if (someCondition && someFunction(argumentNumberOne, argumentNumberTwo, argumentNumberThree, argumentNumberFour, five)) { a(); }
      if (someFunction(argumentNumberOne, argumentNumberTwo, argumentNumberThree, argumentNumberFour, five) && b) { a(); }
      if (someCondition && anotherCondition && oneMoreCondition && "😈😈😈😈😈😈😈😈😈😈😈😈😈😈😈😈😈") { a(); }
      if (someCondition && anotherCondition && oneMoreCondition && yetAnotherCondition && theLastCondition) a();
      if (a) { b(); } else if (someCondition && anotherCondition && oneMoreCondition && yetAnotherCondition1) { a(); }
      while (someCondition && anotherCondition && oneMoreCondition && yetAnotherCondition && theLastCondition) {}
      while (someCondition && anotherCondition && oneMoreCondition && yetAnotherCondition && theLastCondition) { a(); }
      function f() { if (someCondition && anotherCondition && oneMoreCondition && yetAnotherCondition && last) { a(); } }
      for (let i = 0, n = list.length; i < n; i++) { f(i); }
      for (;;) {}
      for (; a; ) b();
      for (a; ; b) c();
      for (var i = ("x" in y); i; ) {}
      for (var i = f(("x" in y)); i; ) {}
      for (const inner = 1, begin = 2; inner < begin; ) {}
      for (const a of b) c(a);
      for (a.b in c) d();
      for await (const a of b) {}
      while (a) b();
      while (a);
      while (a) {}
      do { a(); } while (b);
      do {} while (b);
      do a(); while (b);
      label: for (;;) { break label; }
      label: ;
      label: { a(); }
      { a(); }
      {}
      switch (a) {
        case 1:
        case 2: {
          b();
        }
        case someFunction(argumentNumberOne, argumentNumberTwo, argumentNumberThree): c();
        case 3: // comment
          d();

        case 4: {}
        case 5: ;
        default:
          e();
      }
      switch (a) {}
      switch (a) {
        // comment
        case 1:
      }
      try {} catch {} finally {}
      try {} catch (e) {}
      try { a(); } catch (e: unknown) {} finally { b(); }
      let a, b, c;
      let a = 1, b, c = 2;
      var someVariableName = someFunction(argumentNumberOne), anotherVariableName = argumentNumberTwo;
      let a: { b: string;
        c: number };
      let a: {
        b: string };
      declare const a: { someProperty: string; anotherProperty: number; oneMoreProperty: boolean };
      function f() { let a = 1, b = 2; if (a) return; }
    `,
    "modules.ts": `
      export * from "a";
      export * as b from 'b';
      export type * from "c";
      export type * as d from "someVeryLongModuleSpecifier/someVeryLongModuleSpecifier/someVeryLongModuleSpecifier";
      export * from "e" with { type: "json" };
      export = a;
      export = { a: 1,
        b: 2 };
      export as namespace A;
      export export as namespace A;
      import a = require('a');
      import type b = require("b");
      import c = d.e.f;
      export import g = h.i;
      declare import j = k.l;
      while (a) import m = require("m");
      while (a) export * from "someVeryLongModuleSpecifier/someVeryLongModuleSpecifier/someVeryLongModuleSpecifier";
      label: export * from "someVeryLongModuleSpecifier/someVeryLongModuleSpecifier/someVeryLongModuleSpecifier";
      @aexport default class A {}
      declare export const a;
      export default function () {}
      export default function f() { a(); }
      export default class {}
      export default interface A { a: string }
      declare module "a" { export const a: number; }
      declare module "b";
      declare module 'c' {}
      declare global { var a: number; }
      namespace A.B.C { export const a = 1; }
      module D {}
      export declare namespace E { }
      export namespace F { // comment
      }
    `,
    "declarations.ts": `
      interface A {}
      interface A { a: string }
      export interface A<T, U extends T = T> extends B<T>, C.D { a: string, b?: number; readonly c: T }
      declare interface SomeVeryLongInterfaceName<SomeTypeParameter> extends SomeOtherInterface<SomeTypeParameter>, OneMore {}
      interface A {
        a(): void; b?(c: string): number
        get d(): string; set d(value: string)
        <T>(e: T): T
        new (f: string): A
        new <T>(f: T): A
        [key: string]: unknown
        readonly [index: number]: string;
        "quoted": string; "not-a-name": string; 1: number; [computed]: string; ["a"]: string; [\`b\`]: string
        method(this: A, ...rest: string[]): asserts this is B

        afterAnEmptyLine: string // comment
        /* comment */ withComment: string
        someMethodName(someParameterName: SomeParameterType, anotherParameterName: AnotherParameterType): SomeReturnType;
        someMethodName(someParameterName: SomeParameterType): { someProperty: string; anotherProperty: number; more: 1 };
        someMethodName({ a, b }: { a: string; b: number; someProperty: string; anotherProperty: number }): void;
        someProperty: { someProperty: string; anotherProperty: number; oneMoreProperty: boolean; more: 1 };
        someProperty: Array<{ someProperty: string; anotherProperty: number; oneMoreProperty: boolean }>;
        someProperty: { someProperty: string; anotherProperty: number; oneMoreProperty: boolean }[] ;
        someProperty: { someProperty: string; anotherProperty: number; oneMoreProperty: boolean } | null;
        someProperty: SomeType | AnotherType | OneMoreType | YetAnotherType | AndAnotherType | TheLastType;
        nested: {
          a: string; b: {
            c: number }
        }
        nested: Promise<{
          a: string }>
        nested: {
          a: string } | null | void;
      }
      enum A {}
      enum A { B, C = 1, D = "d", "e-f" = 2, 'g' }
      export declare const enum A { B = 1 << 0, C = B | 2, D = someFunction(argumentNumberOne, argumentNumberTwo, three) }
      const enum A { B /* comment */, C, // comment
        D }
      type A = { a: string };
      type A = {
        a: string };
      type A<T> = { someProperty: string; anotherProperty: number; oneMoreProperty: boolean; more: T };
      type A<T extends B, U = C> = { someProperty: string; anotherProperty: number; oneMoreProperty: boolean };
      function f(a: string, b: number): void {}
      function f(this: A, a?: string, ...b: number[]): void;
      declare function f<const T, U>(a: T): U;
      interface A<in out T, in U, out V> {}
      export async function* someFunctionName<T>(someParameterName: SomeParameterType, another: AnotherParameterType) {}
      export function someFunctionName(someParameterName: SomeParameterType, another: AnotherParameterType): T { a(); }
      function someFunctionName(someParameterName: SomeParameterType<WithSomeArguments, AndMore, AndEvenMoreOfThemHere>) {}
      function someFunctionName(someParameterName: SomeParameterType = someDefaultValue(withArguments, andMore, andMore)) {}
      function someFunctionName(someParameterName: SomeParameterType): SomeReturnType<{ a: string; b: number; c: 1 }> {}
      function someFunctionName({ someProperty, anotherProperty, oneMoreProperty }: SomeParameterType, b: string) {}
      function someFunctionName({ someProperty, anotherProperty, oneMoreProperty, andAnother }: SomeParameterType) {}
      function someFunctionName(a: string,

        b: string, someParameterName: SomeParameterType, anotherParameterName: AnotherParameterType) {}
      function someFunctionName(a: "😈😈😈😈😈😈😈😈😈😈😈😈😈😈😈😈😈😈😈😈😈😈😈😈😈😈😈😈", b: "😈😈😈") {}
      function someFunctionNameThatIsLong(): SomeReturnType<WithSomeArguments, AndMore, AndEvenMoreOfThemHereAndThere> {}
    `,
    "classes.ts": `
      class A {}
      class A extends B {}
      abstract class A<T> extends B<T> implements C, D.E { }
      @a class A {}
      @a @b() class A { c = 1 }
      @a
      export class A {}
      @a export default class A {}
      @a()export class A {}
      export @a class A {}
      @Component({
        selector: "a",
      })
      export class A {}
      @Component({ selector: "some-selector", template: "some template that is long", more: true })
      class A {}
      @Some.Decorator(argumentNumberOne, argumentNumberTwo, argumentNumberThree, argumentNumberFour)
      class SomeVeryLongClassName extends SomeOtherVeryLongClassName implements SomeInterface, AnotherInterface {}
      @(a.b()) @(a[0]) @(await b) class A {}
      class A {
        @a b = 1;
        @a() b: string;
        @a()
        b: string;
        @a() @b c() {}
        @Input("someArgumentName") someProperty: string | string[];
        /* c */ @Input("someArgumentName") someProperty: string | string[];
        /* c
c */ @Input("someArgumentName") someProperty: string | string[];
        /* c
c */ someMethodName(someParameterName: SomeParameterType, another: AnotherParameterType) {}
        @Input("someArgumentName") someMethod(someParameter: string, another: number) {}
        @Input("someArgumentName") someProperty = { a: 1, b: 2, c: 3 };
        @Input("someArgumentName") someProperty: { a: string; b: number };
        @a()
        @b c() {}
        @Input() someProperty: SomeType<WithArguments> = someFunction(argumentNumberOne, argumentNumberTwo);
        @Input("someArgument")
        someProperty: SomeType<WithArguments> = someFunction(argumentNumberOne, argumentNumberTwo, three);
        @HostListener("window:resize", ["$event"]) onResize(someParameterName: SomeParameterType, b: string) {}
        @HostListener("window:resize", ["$event"])
        onResize(someParameterName: SomeParameterType, anotherParameterName: AnotherParameterType) {}
        @Output({
          a: 1 }) b = 1;
        @Output({
          a: 1 })
        b = 1;
        someProperty: SomeType<WithArguments> = new SomeType<WithArguments>();

;  /** a comment that is printed after the property */
        someProperty: SomeType<WithArguments> = new SomeType<WithArguments>();
/* c
 d */
;  /** a comment that is printed after the property */
        abstract a(): void;
        abstract b: string;
        protected abstract override c?(): void;
        d(): void;
        d(e: string): void;
        d(e?: string) {}
        [key: string]: unknown;
        static readonly [key: string]: unknown;
        "quoted" = 1; "not-a-name" = 2; 3 = 4; [computed] = 5; ["a"]() {} #private = 6;
        'constructor'() {}
        constructor() {}
        constructor(private a: string) {}
        constructor(private a: string, b: number) {}
        constructor(a: string, protected readonly b = 1, ...c: string[]) { super(); }
        constructor(@Inject(A) a: A, @Inject(B) private b: B) {}
        constructor(@Inject(A) a: A, @Inject(B)
          b: B) {}
        constructor(@Inject(SOME_VERY_LONG_TOKEN_NAME) private readonly someParameterName: SomeParameterType<A>, b) {}
        constructor(private someParameterName: SomeParameterType, private anotherOne: { a: string; b: number; c: 1 }) {}
        override constructor() {}
        someMethodName(someParameterName: SomeParameterType, anotherParameterName: AnotherParameterType) {}
        async *someMethodName<T>(someParameterName: SomeParameterType, another: AnotherParameterType): T { a(); }
        get someAccessorName(): SomeReturnType<WithSomeArguments, AndMore, AndEvenMoreOfThemHereAndThere> { return 1; }
        set a(value) {}
        static {}
        static { a(); }
        accessor a = 1;
        declare a: string;
        a!: string; b?: number;
        a: { b: string;
          c: number };
        a: {
          b: string };
        someProperty: { someProperty: string; anotherProperty: number; oneMoreProperty: boolean; more: 1 };
      }
    `,
    "types.ts": `
      type A = string | number | null;
      type A = | B;
      type A = & B;
      type A = | B | C;
      type A = (B | C)[] | (D & E)[] | (keyof F)[] | (typeof g)[] | (() => void)[] | (new () => H)[] | (infer I)[];
      type A = B & C & { d: string } & { e: string };
      type A = [B, C?, ...D[]] | [a: B, b?: C, ...c: D[]] | [] | [B | C, D];
      type A = 1 | -1 | - 1 | 1.0 | 0XAB | 1n | -1n | 0XABn | "a" | 'b' | \`c\` | \`d\${E}f\` | true | false;
      type A = typeof a | typeof a.b.c | typeof a<B> | typeof import("a") | typeof this.a;
      type A = import("a") | import('a').B | import("a").B.C<D> | import("a", { with: { "resolution-mode": "import" } });
      type A = keyof B | readonly C[] | unique symbol | B["c"] | B[number][0];
      type A = () => void | (() => void) | ((a: B) => a is C) | (new () => D) | (abstract new () => E);
      type A = <T>(this: B, a?: T, ...b: T[]) => asserts a is T;
      type A = (a) => asserts a;
      type A<T> = T extends B ? C : D;
      type A<T> = T extends B ? C : T extends D ? E : F;
      type A<T> = T extends B ? T extends C ? D : E : F;
      type A<T> = (T extends B ? C : D) extends E ? F : G;
      type A<T> = T extends (infer U extends B)[] ? U : T extends (infer U)[] ? U : never;
      type A<T> = T extends (...a: infer B) => infer C ? [B, C] : never;
      type A = { [K in B]: C } | { readonly [K in B]?: C } | { +readonly [K in B]+?: C } | { -readonly [K in B as D]-?: C };
      type A = { [K in B] };
      type A = {
        [K in B]: C };
      type A = {};
      type A = { a: string, b(): void; c?: { d: number } };
      type A = Array<{ a: string }> | Promise<B<C, D>>;
      type A = intrinsic;
      type A = (intrinsic);
      type A = ({ a: string });
      type A = ((B));
      let a: A.B.C<D>["e"][] = f as G<H> satisfies I;
      let a = <T,>(b: T) => b;
      function f(a: [string, number], b: { c: string }, d: () => void, e: typeof f): a is [string, number] {}
      type SomeVeryLongTypeName = SomeType | AnotherType | OneMoreType | YetAnotherType | AndAnotherType | Last;
      type SomeVeryLongTypeName<T> = T extends SomeType ? AnotherType<T> : OneMoreType<T, YetAnotherType, AndMore>;
      type A = "some string" | "another string" | "one more string" | "yet another string" | "and another" | "last";
      type A = | "some string" | "another string" | "one more string" | "yet another string which is long" | "l";
      type A = SomeType | ((someParameter: SomeParameterType, anotherParameter: AnotherParameterType) => SomeReturnType);
      type A = SomeType | { someProperty: string; anotherProperty: number; oneMoreProperty: boolean; more: 1; evenMore: 2 };
      type A = SomeType | {
        a: string } | AnotherType;
      type A = "😈😈😈😈😈😈😈😈😈😈😈😈😈😈😈😈" | "😈😈😈😈😈😈😈😈😈😈😈😈" | "😈😈😈😈😈😈😈😈";
      type A = SomeType | AnotherType | OneMoreType /* comment */ | YetAnotherType | AndAnotherType | TheLastType;
      type A = SomeType | { a: string; // comment
        } | AnotherType // comment2
        | OneMoreType;
      type A = (
        // comment
        B | C) | D;
      type A = { direction?: string } & (SomeVeryLongTypeName | AnotherVeryLongTypeName | OneMoreTypeName);
      type A = (someParameter: SomeParameterType, anotherParameter: AnotherParameterType) => SomeReturnType;
      type A = new (someParameter: SomeParameterType, anotherParameter: AnotherParameterType) => SomeReturnType;
      type A = <T>(someParameter: SomeParameterType<T>, anotherParameter: AnotherParameterType) => SomeReturnType<T>;
      type A = (someParameter: SomeParameterType) => { someProperty: string; anotherProperty: number; more: boolean };
      type A = (someParameter: { someProperty: string; anotherProperty: number; more: boolean; evenMore: 1 }) => void;
      type A = (config: {
        value: string }) => void;
      type A = () => SomeReturnType<WithSomeArguments, AndMore, AndEvenMoreOfThemHereAndThere, AndSomeMoreOfThem>;
      type A = B & {
        c: string };
      type A = {
        c: string } & B;
      type A = {
        c: string } & { d: string };
      type A = { c: string } & {
        d: string };
      type A = B & C & {
        d: string };
      type A = SomeType<WithArguments> & { someProperty: string; anotherProperty: number; oneMoreProperty: boolean };
      type A = { someProperty: string; anotherProperty: number; oneMoreProperty: boolean } & SomeType<WithArguments>;
      type A = { someProperty: string; anotherProperty: number } & { oneMoreProperty: boolean; yetAnother: string };
      type A = SomeVeryLongTypeName & AnotherVeryLongTypeName & OneMoreVeryLongTypeName & YetAnotherVeryLongTypeName;
      type A = { [SomeKey in keyof SomeVeryLongTypeName]: SomeVeryLongTypeName[SomeKey] extends B ? C : never };
      type A = ReturnType<typeof someVeryLongFunctionNameThatGoesOnAndOnAndOnAndOnAndOnAndOnAndOnAndOnAndOn>;
      type SomeVeryLongTypeNameThatGoesOnAndOn = SomeOtherVeryLongTypeNameThatGoesOnAndOnAndOnAndOnAndOnAndOn;
      interface A {
        onChange?: (someParameter: SomeParameterType, anotherParameter: AnotherParameterType) => SomeReturnType;
        onChange?: null | ((someParameter: SomeParameterType, anotherParameter: AnotherParameterType) => void) | undefined;
        someProperty: "some string" | "another string" | "one more string" | "yet another string" | "last";
        someProperty: B & {
          c: string };
        someProperty: {
          [K in B]: C };
      }
      class A {
        someProperty: "some string" | "another string" | "one more string" | "yet another string" | "last one";
        onChange?: (someParameter: SomeParameterType, anotherParameter: AnotherParameterType) => SomeReturnType;
      }
      let someVariable: "some string" | "another string" | "one more string" | "yet another string" | "last one";
    `,
  };
  const options = [
    [],
    ["--print-width=20"],
    ["--print-width=40", "--tab-width=4"],
    ["--print-width=60", "--trailing-comma=none"],
    ["--print-width=100", "--use-tabs", "--single-quote", "--no-bracket-spacing"],
    ["--print-width=120", "--trailing-comma=es5", "--quote-props=consistent"],
    ["--print-width=1", "--quote-props=preserve"],
    ["--print-width=1000", "--object-wrap=collapse", "--tab-width=0"],
  ];
  test.concurrent.each(options)("%s %s %s %s", async (...options) => {
    const [withShortCuts, without] = await difference(files, options.filter(Boolean));
    expect(withShortCuts).toEqual(without);
    // Every file has been formatted.
    expect(without.stderr).toBe("");
    expect(without.exitCode).toBe(0);
  });

  // Where a line ends within a few columns of the limit is where a wrong width shows.
  test("every width", async () => {
    const widths = Array.from({ length: isDebug ? 8 : 40 }, (_, i) => 50 + i * (isDebug ? 5 : 1));
    const different: number[] = [];
    await Promise.all(
      widths.map(async width => {
        const [withShortCuts, without] = await difference(files, [`--print-width=${width}`]);
        if (!Bun.deepEquals(withShortCuts, without)) different.push(width);
      }),
    );
    expect(different).toEqual([]);
  });
});

// Nothing can break in the head of such a call, so what's before it on the line breaks instead, if anything can.
describe.skipIf(!hasFlag)("calls of test functions", () => {
  const calls = [20, 45, 55, 65, 90].flatMap(length => {
    const name = `should ${Buffer.alloc(100, "x")}`.slice(0, length);
    return ["{}", "{\n  a();\n}"].flatMap(body => [
      `it('${name}', async () => ${body})`,
      `it('${name}', (done) => ${body})`,
      `it('${name}', function () ${body})`,
      `it('${name}', fakeAsync(() => ${body}))`,
      `it.only('${name}', () => ${body})`,
      `beforeEach(waitForAsync(() => ${body}))`,
      `test('${name}', async ({ page }) => ${body})`,
      `it(\`${name}\`, () => ${body})`,
      `it('${name}', () => ${body}, 1000)`,
    ]);
  });
  const places = [
    "%;",
    "await %;",
    "return %;",
    "return await %;",
    "const x = %;",
    "const [firstRadio, secondRadio, thirdRadio] = %;",
    "const { firstRadio, secondRadio } = %;",
    "x = %;",
    "x.y = %;",
    "const x = await %;",
    "x = { a: % };",
    "x = {\n  a: %,\n};",
    "foo(%);",
    "foo(a, %);",
    "foo(%, a);",
    "x = () => %;",
    "const f = async () => await %;",
    "x = [%];",
    "x = a || %;",
    "x = a ? % : b;",
    "void %;",
    "(%).then(a);",
    "throw %;",
    "if (%) a();",
    "x = y = %;",
    "for (const a of %) b();",
    "x = `${%}`;",
    "const veryLongNameOfAVariableThatTakesRoom = %;",
    "this.veryLongNameOfAProperty.another = %;",
  ];
  const files = Object.fromEntries(
    places.map((place, index) => [
      `${index}.ts`,
      `async function f() {\n${calls.map(call => place.replace("%", () => call)).join("\n")}\n}\n`,
    ]),
  );
  files["members.ts"] = `class A {\n${calls.map(call => `a = ${call};`).join("\n")}\n}\n`;

  test.concurrent.each([[], ["--print-width=60", "--no-semi"], ["--print-width=100", "--use-tabs"]])(
    "%s %s",
    async (...options) => {
      const [withShortCuts, without] = await difference(files, options.filter(Boolean));
      expect(withShortCuts).toEqual(without);
      expect(without.stderr).toBe("");
      expect(without.exitCode).toBe(0);
    },
  );
});

// Whether the right side stays on the line of the `=` depends on where it can break first.
describe.skipIf(!hasFlag)("what an operator or parentheses are around, in every place", () => {
  const [a, b, c, d, e] = ["a", "b", "c", "d", "e"].map(it => it.repeat(12));
  const cores = [
    a,
    `${a} ? ${b} : ${c}`,
    `${a} && ${b}`,
    `${a} || ${b} && ${c}`,
    `${a} + ${b} + ${c}`,
    `${a}, ${b}`,
    `(${a}) => ${b}`,
    `(${a}) => {\n  ${b}();\n}`,
    `{ ${a}: ${b}, ${c} }`,
    `{\n  ${a}: ${b}, ${c} }`,
    "{}",
    `[${a}, ${b}, ${c}]`,
    `${a}(${b}, ${c})`,
    `${a}.${b}(${c}).${d}(${e})`,
    `${a} = ${b}`,
    `new ${a}(${b}, ${c})`,
    `'${a} ${b} ${c}'`,
  ];
  const wrappers = [
    "%",
    "await (%)",
    "void (%)",
    "typeof (%)",
    "!(%)",
    "-(%)",
    `new (%)(${d})`,
    `(%) as ${d}`,
    "(%)!",
    `(%).${d}`,
    `(%)(${d})`,
    `(await (%)).${d}`,
    `(%) && ${d}`,
    `${d} && (%)`,
    `(%) ? ${d} : ${e}`,
    `${d} ? (%) : ${e}`,
    "[...(%)]",
    `${d}(...(%))`,
    "() => (%)",
  ];
  const places = [
    "%;",
    `${e} = %;`,
    `${e}.${d}.${c} = %;`,
    `${e} ||= %;`,
    `const x = %;`,
    `let x: ${d} = %;`,
    `const { ${e}, ${d} } = %;`,
    `const [${e}, ${d}] = %;`,
    "return %;",
    `x = {\n  ${e}: %,\n};`,
    `x = {\n  [${e}]: %,\n};`,
    `${e} = () => %;`,
    `${e}(() => %);`,
    `${e}(${d}, %);`,
    "if (%) {\n  x();\n}",
  ];
  const files = Object.fromEntries(
    places.map((place, index) => [
      `${index}.ts`,
      `async function f() {\n${wrappers
        .flatMap(wrapper => cores.map(core => `{\n${place.replace("%", () => wrapper.replace("%", () => core))}\n}`))
        .join("\n")}\n}\n`,
    ]),
  );

  test.concurrent.each(Array.from({ length: isDebug ? 4 : 12 }, (_, index) => 22 + index * (isDebug ? 12 : 4)))(
    "--print-width=%d",
    async width => {
      const [withShortCuts, without] = await difference(files, [`--print-width=${width}`]);
      expect(withShortCuts).toEqual(without);
      expect(without.stderr).toBe("");
      expect(without.exitCode).toBe(0);
    },
  );
});

// The parameters of a function that's the last argument stay on one line. What else is in its head can break.
describe.skipIf(!hasFlag)("heads of functions", () => {
  const [a, b, c, d, e] = ["a", "b", "c", "d", "e"].map(it => it.repeat(8));
  const [T, U] = ["Aaaaaaaa", "Bbbbbbbb"];
  const parameters = ["", a, `${a}, ${b}`, `${a}: ${T}, ${b}: ${U}`, `{ ${a}, ${b} }`, `${a}, ...${b}`, `${a} = 1`];
  const returnTypes = [
    "",
    `: ${T}`,
    `: ${T} | ${U}`,
    `: Promise<${T}<${U}>>`,
    `: { a: ${T}; b: ${U} }`,
    `: (${a}: ${T}) => ${U}`,
    `: ${T} extends ${U} ? ${T} : ${U}`,
  ];
  const typeParameters = ["", "<T>", `<T extends ${T}>`];
  const heads = [
    "function e% {\n  x();\n}",
    `${e}(function % {\n  x();\n});`,
    `${e}(function % {});`,
    `${e}(${d}, function % {\n  x();\n});`,
    `${e}(function % {\n  x();\n}, ${d});`,
    `${e}(% => {\n  x();\n});`,
    `${e}(${d}, % => {\n  x();\n});`,
    `${e}(% => ${c});`,
    `new ${e}(function % {\n  x();\n});`,
    `${e}.${d}(function % {\n  x();\n});`,
    `const ${d} = ${e}(function % {\n  x();\n});`,
    `const ${d} = ${e}(% => {\n  x();\n});`,
    `const ${d} = % => {\n  x();\n};`,
    `const ${d} = function % {\n  x();\n};`,
    "class X {\n  e% {\n    x();\n  }\n}",
    "interface X {\n  e%;\n}",
    "x = {\n  e% {\n    x();\n  },\n};",
  ];
  const files = Object.fromEntries(
    heads.map((head, index) => [
      `${index}.ts`,
      typeParameters
        .flatMap(typeParameter =>
          parameters.flatMap(parameter =>
            returnTypes.map(returnType => head.replace("%", () => `${typeParameter}(${parameter})${returnType}`)),
          ),
        )
        .join("\n"),
    ]),
  );

  test.concurrent.each(Array.from({ length: isDebug ? 4 : 12 }, (_, index) => 24 + index * (isDebug ? 15 : 5)))(
    "--print-width=%d",
    async width => {
      const [withShortCuts, without] = await difference(files, [`--print-width=${width}`]);
      expect(withShortCuts).toEqual(without);
      expect(without.stderr).toBe("");
      expect(without.exitCode).toBe(0);
    },
  );
});

describe.skipIf(!hasFlag)("what breaks whether it fits or not, and what only looks like it", () => {
  const files = {
    // Functions among the arguments are each on a line.
    "import-calls.js": `
      import(n, a(() => e));
      import(() => k, () => g);
      import(a, () => {});
      x = import(n, a(() => e));
      f(import(n, a(() => e)));
      import(n, a(() => e)).then(b);
      if (import(n, a(() => e))) {}
      async function f() {
        await import(n, a(() => e));
      }
    `,
    // A template breaks where a function in it has statements.
    "templates.js": `
      const [b] = \`\${a(() => { a; })}\`;
      const { o } = \`\${t("", () => { 5(); })}\`;
      const { d } = \`\${async function () { x; } | l}\`;
      const { e } = \`\${a(function () { x; })}\`;
      const f = \`\${a(() => { a; })}\`;
      g.h = \`\${a(() => { a; })}\`;
      const [i] = \`\${a(b, c)} \${d}\`;
      const [j] = \`\${a(() => { a; })}\` ? k : l;
    `,
    // What's ignored is copied, so nothing in it forces a line break.
    "ignored.js": `
      while (a) b = [/* prettier-ignore */ function () { x; }];
      function f() {
        for (;;) return [() => /* prettier-ignore */ (function () { x; })];
      }
      if (a) b(() => /* prettier-ignore */ (function () { x; }));
      b = { c: /* prettier-ignore */ function () { x; } };
      b(c, [/* prettier-ignore */ { d:  1 }, { e: 2 }]);
    `,
    "ignored.ts": `
      e<e>(t("e", () => /* prettier-ignore */ { x; }));
      e(t("e", () => /* prettier-ignore */ { x; }));
    `,
    // A comment after white space that isn't a blank or a tab doesn't start its line.
    ...Object.fromEntries(
      ["\u00a0", "\u2003", "\ufeff", "\f", "\v", " ", "\t"].flatMap((space, index) => [
        [`after-line-break-${index}.js`, `[e];\n${space}/* c */\n`],
        [`on-the-line-${index}.js`, `"".b${space}/**/\n`],
        [`before-${index}.js`, `/* c */${space}[e, f];\n`],
        [`property-${index}.js`, `a = {\n  b: [c],\n${space}/* c */\n  d,\n};\n`],
      ]),
    ),
    "closing-tag.jsx": "function a(a = <a>a\nb</a\n/**/>) {}\n",
    // A comment at the end of a body without braces is printed before the \`else\`.
    "before-else.ts": `
      if (secondLink === linkMap) value = call(operands[2], operands[3], value, index, more) /* a
       b */;
      else if (secondLink === linkFilter) {
      } else reached = appendParts(out, reached, call(endCallback, endThis, value, index, array));
      if (a) b(() => {
        c();
      }) /* d */;
      else e();
      if (a) b(c) /* d */; else e();
      if (a) b(c); /* d */ else e();
      if (a) b(c); // d
      else e();
    `,
    // A pattern that nothing is assigned to breaks with the declaration.
    "patterns.ts": `
      const users = new Map<string, { name: string }
      function greet(id: string) {}
      var a = 1, { b: c };
      var { d: e }, f = 1;
      var [g], h = 1;
      var { i }, j;
      let { k };
      const { l }: {
       m: n };
      declare const { o }: {
       p: q };
    `,
    "language-comments.js":
      "/* GraphQL */\n`{a}`;\n/* HTML */\n`<a>b</a>`;\n/* c */\n`{a}`;\nx =\n  /* GraphQL */\n  `{a}`;\n",
    // Whether the element before \`{" "}\` is measured with it depends on what the printer has measured before.
    "before-jsx-space.jsx": ["", "<b />", "<b>\n  ccccccc\n  <d>e</d>\n</b>", "<b>\n  <d>e</d>\n</b>", "text"]
      .map(
        first =>
          `a = (\n<>\n${first}\n<Divider orientation="left">sub-element xxxxxxxxxxxxxxxxxx center</Divider> <Row>\n</Row>\n</>\n);\n`,
      )
      .join(""),
    // \`<c />\` is on a line of its own in a fill and is no group, so what follows \`</b>\` is still measured.
    "after-element-without-group.jsx":
      'x = <a><b>t<c/><d/></b>{{eeee: ffff}}{" "}e</a>;\ne = <><b>ae<c/></b>{e} e</>;\ne = <><b>ae<c/></b><d>e</d> e</>;\n',
    "optional-targets.ts":
      "a?.bbbbbbbb.cccc = `/${dddd.eeeee}/`;\na?.b = c(dddddddd, eeeeeeee);\nf = a?.b.c = `${dddddddddd}`;\n",
    // A chain is on one line if it fits up to its first line break, which can be in the head of the function.
    "chains-before-functions.ts": `
      d = d.h().i(function <x>(y): z { x; });
      d = d.h().i(function (y): { a } { x; });
      dd = dd.hh().ii(function (yy): { aa: bb } { x; });
      d = d.h().i((y = a.b().c()) => { x; });
    `,
    // Of the arguments of a call in the head of a function that's hugged, the widest variant is measured.
    "calls-in-default-values.ts": `
      a(({ e = a({ n }) }) => f(() => { x; }));
      a((e = a([n])) => { x; });
      a((e = a({ n })) => f(x, y));
      new A((e = a([n])) => { x; }, b);
      abc(({ e = a({ n }) }) => { x; });
      abcde(({ e = { l: a(b, { n }) } }) => { x; });
    `,
    // It stays on the line of the \`=\` if that fits up to the \`(\`.
    "this-called.ts":
      "a = this(bcd, efg);\nconst b = this(bcd) as E;\nclass A { a = this(bcd); }\na = this({ b: c });\na = new this(bcd, efg);\n",
    // A comment before the \`{\` is printed before the first statement, which starts after it.
    "static-blocks.ts":
      "class A { static /*\nd*/ { f(aaaaaaaaaa, bbbbbbbbbb); } }\nclass B { static /* c */ { f(aaaaaa, bbbbbb); } }\n",
    // Where the column is a guess, the printer has to know of the \`;\` or the \`,\` after a chain that always breaks.
    "chains.ts": `
      x = a || class d { a = l().p().t(b + c); };
      a, {
       a: l().p().t(b + c) };
      x = a ? class d { a = l().p().t(b, c + e); } : f;
    `,
    // A line break after \`<T>\` doesn't break what's around it.
    "assertions-in-bodies.ts": `
      if (a) b = { a: <T>function () { c; } };
      if (a) b = [<T>function () { c; }];
      if (a) b = { a: <T>e([], function () { c; }) };
      if (a) b = { a: function () { c; } as T };
    `,
    "cases.js": `
      switch (a) { case bbbbbbbb + cccccccc: {/* prettier-ignore */} }
      switch (a) { case bbbbbbbb + cccccccc: {/* c */} }
      switch (a) { case bbbbbbbb + cccccccc: {} }
      switch (a) { case bbbbbbbb + cccccccc: { d(); } }
    `,
    "html-comments.js": "try { a; } finally <!--\n{ b; }\n",
    "after-line-comment.js": "a = { /* c */ // d\n  b: 'c'// c\n,/** c */ /**\n */\n};\n",
    // A chain in a default value breaks without the parameters.
    "default-values.js": `
      d((a = d.e().a()) => {});
      d(({} = d.e().a()) => {});
      d(([a] = d.e().a(), b) => { c(); });
      d(a, (b = d.e().a()) => {});
      new d((a = d.e().a()) => {});
      d((a = f(bbbbbb)) => {});
      d((a = 1) => {});
    `,
    "assertions-in-conditions.ts":
      "if (a && <{\n b: c }>d) { e; }\nwhile (a && <a<{\nT}>>x) { e; }\nif (a < b && c) { e; }\n",
    // A comment after a \`(\` belongs to what's before the parenthesis.
    "comments-in-parentheses.mjs": `
      new l(2, (/**/
      a((a) => { n(); })));
      e((// c
      f(() => { l; })));
      await e((e(2, () => {})
      //
      ), 2);
      x = a ? (/* c */
      b(() => { c(); })) : d;
    `,
    // What's after \`<T>\` is printed flat first.
    "assertions.ts": `
      x = <a>function () {
        @x class a {}
      };
      <T>((c) => {
        interface a {
          o;
        }
      });
      <T>((c) => {
        f((y) => {
          enum a {
            b,
          }
        });
      });
      x = <T>class {
        m() {
          interface a {
            o(): j;
          }
          enum b {
            c = 1,
          }
          switch (d) {
            case 1:
              e();
          }
          namespace f {
            g();
          }
        }
      };
    `,
  };

  test.concurrent.each([5, 8, 10, 12, 15, 18, 20, 24, 28, 40, 80])("--print-width=%d", async width => {
    const [withShortCuts, without] = await difference(files, [`--print-width=${width}`]);
    expect(withShortCuts).toEqual(without);
    expect(without.stderr).toBe("");
    expect(without.exitCode).toBe(0);
  });

  test("a parameter with a modifier and without parentheses", async () => {
    const [withShortCuts, without] = await difference({ "a.js": "// @flow\nx = (readonly a) => b;\n" }, [
      "--arrow-parens=avoid",
    ]);
    expect(withShortCuts).toEqual(without);
    expect(without.exitCode).toBe(0);
  });
});

describe.skipIf(!hasFlag)("names, literals, member accesses, calls and operators", () => {
  const binary = "?? || && | ^ & == != === !== < <= > >= in instanceof << >> >>> + - * / % **".split(" ");
  const unary = ["!", "-", "+", "~", "typeof ", "void ", "delete ", "++", "--", "await "];
  // In every place that knows what it's in.
  const places = (e: string) => [
    `x = ${e};`,
    `const y = ${e};`,
    `if (${e}) g();`,
    `while (${e}) {\n  g();\n}`,
    `return ${e};`,
    `g(${e}, 1);`,
    `${e};`,
    `x = (${e}).y;`,
    `x = !(${e});`,
    `switch (${e}) {\n  case ${e}:\n    g();\n}`,
    `for (; ${e}; ${e}) g();`,
    `x = (${e}) ? 1 : 2;`,
    `x = new (${e})();`,
    `x = \`\${${e}}\`;`,
  ];
  const isError = (first: string, second: string) =>
    ((first === "??") !== (second === "??") && [first, second].some(it => it === "||" || it === "&&")) ||
    ((first === "<" || first === "<<") && second.startsWith(">"));
  const files: Record<string, string> = {};
  for (const [index, first] of binary.entries()) {
    const expressions: string[] = [];
    for (const second of binary) {
      expressions.push(`(a ${first} b) ${second} c`, `a ${first} (b ${second} c)`, `(a.b ${first} c()) ${second} d[0]`);
      if (!isError(first, second)) expressions.push(`a ${first} b ${second} c`, `a.b ${first} c() ${second} 1`);
    }
    for (const operator of unary) {
      const operand = operator === "++" || operator === "--" || operator === "delete " ? "a.b" : "a";
      expressions.push(`(${operator}${operand}) ${first} b`, `a ${first} ${operator}${operand}`);
      if (first !== "**") expressions.push(`${operator}${operand} ${first} b`);
      if (operand === "a") expressions.push(`${operator}(a ${first} b)`);
      if (operator === "++" || operator === "--")
        expressions.push(`a.b${operator} ${first} c`, `c ${first} a.b${operator}`);
    }
    files[`operators-${index}.ts`] = `async function f() {\n${expressions.flatMap(places).join("\n")}\n}\n`;
  }
  files["unary.ts"] = `async function f() {\n${unary
    .flatMap(outer =>
      unary.flatMap(inner => {
        if (outer === "++" || outer === "--") return [];
        const operand = inner === "++" || inner === "--" || inner === "delete " ? "a.b" : "a";
        const isOneToken = "+-".includes(outer.trim()) && inner.startsWith(outer.trim());
        return [`${outer}(${inner}${operand})`, ...(isOneToken ? [] : [`${outer}${inner}${operand}`])];
      }),
    )
    .flatMap(places)
    .join("\n")}\n}\n`;
  // What is between the tokens decides whether a chain is copied from the source.
  const chains = [
    "a.b.c",
    "a .b.c",
    "a. b.c",
    "a.b .c",
    "(a).b.c",
    "(a.b).c",
    "((a.b.c))",
    "a\n  .b.c",
    "a.b()",
    "a.b( )",
    "a.b ()",
    "a.b(c)",
    "a.b( c)",
    "a.b(c )",
    "a.b((c))",
    "a.b(c,)",
    "a.b(c, d)",
    "a.b(c,d)",
    "a.b(c ,d)",
    "a.b(c,  d)",
    "a.b(c,\n  d)",
    "a.b(c, d,)",
    "a.b(c, d).e",
    "a.b(c,d).e",
    "a.b(c).d(e)",
    "a.b(c).d( e)",
    "a.b( c).d(e)",
    "a.b(c).d(e).f(g)",
    "a[0]",
    "a[ 0]",
    "a[0 ]",
    "a [0]",
    "a[b].c",
    "a[(b)].c",
    "a[b.c].d",
    "a[0][1]",
    "a[0x1]",
    "a[1.0]",
    ".5.a",
    ".0e0.e60",
    "1.5.a.b",
    "1..a",
    "1.0.a()",
    "0x1.a",
    "1e3.a.b",
    "a.b(1.0)",
    "a.b(0)",
    "a.b(null, true, false, this)",
    "this.a.b",
    "this .a",
    "(this).a",
    "this.a(this.b)",
    "a.#b.c",
    "a.b('c')",
    'a.b("c")',
    "a.b('c\"d')",
    'a.b("c\'d")',
    "a.b('', \"\")",
    "a.b('c', d)",
    "a('b').c",
    "a?.b.c",
    "a.b?.c",
    "a.b?.()",
    "a!.b",
    "a.b!",
    "a.b<c>()",
    "a.b(c)(d)",
    "a()()()",
    "let.a",
    "async.a()",
    "await.a",
    "type.a",
    "graphql(a, b)",
    "a.graphql(a, b)",
    "a.veryLongNameOfAProperty.anotherVeryLongNameOfAProperty.yetAnotherVeryLongNameOfAProperty.b",
    "a.veryLongNameOfAFunction(anArgumentWithALongName, anotherArgumentWithALongName, b)",
    "\u0061.b",
    "a.\\u0062",
    "é.b.c",
    "a.é('é')",
  ];
  files["chains.ts"] = `function f() {\n${chains.flatMap(places).join("\n")}\n}\n`;
  files["targets.ts"] = `function f() {\n${chains
    .filter(it => !/[)!?]$|^\(\(|\?\./.test(it))
    .flatMap(it => [`${it} = 1;`, `${it}  =  a.b(c);`, `${it} += a.b;`, `${it}++;`])
    .join("\n")}\n}\n`;

  test.concurrent.each([
    [],
    ["--single-quote"],
    ["--no-semi"],
    ["--print-width=20"],
    ["--print-width=30", "--use-tabs"],
    ["--print-width=40", "--single-quote", "--tab-width=4"],
  ])("%s %s %s", async (...options) => {
    const [withShortCuts, without] = await difference(files, options.filter(Boolean));
    expect(withShortCuts).toEqual(without);
    expect(without.stderr).toBe("");
    expect(without.exitCode).toBe(0);
  });
});

/** Formats `files` with `options`, with and without short cuts. Returns what is written and said each way. */
async function bothWays(files: Record<string, string>, options: string[]) {
  using dir = tempDir("fmt-short-cuts", {
    short: files,
    long: files,
  });
  const run = async (name: string, flags: string[]) => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "fmt",
        "--write",
        "--no-config",
        "--no-editorconfig",
        "--log-level=warn",
        ...options,
        ...flags,
        ".",
      ],
      env: bunEnv,
      cwd: join(String(dir), name),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const written = Object.fromEntries(
      Object.keys(files).map(file => [file, readFileSync(join(String(dir), name, file), "utf8")]),
    );
    return { written, stdout, stderr, exitCode };
  };
  const [short, long] = await Promise.all([run("short", []), run("long", ["--no-short-cuts"])]);
  return { short, long };
}

describe.skipIf(!hasFlag)("HTML", () => {
  const line = (indentation: number, text: string) => " ".repeat(indentation) + text + "\n";
  const words = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore";
  // With four blanks in front of it, `tempor` does not fit behind it.
  const full = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod";
  const attributes = 'class="one two three" id="an-identifier" data-something="a value with words" hidden';
  // Children on lines of their own are read from the bytes.
  const inputs: string[] = [
    "<div>\n  <p>a</p>\n  <p>b</p>\n</div>\n",
    // Another indentation, blank lines, tabs, white space at the ends of lines.
    "<div>\n<p>a</p>\n      <p>b</p>\n\n\n\t<p>c</p>  \n\n</div>\n",
    // The name of an element ends where the lexer ends it.
    "<span>a</span>\n<div&>b</div&>\n",
    "<span>a</span>\n<div&\n>b</div&>\n",
    "<div&>b</div&>\n<span>a</span>\n",
    "<span>a</span>\n<div=>b</div=>\n",
    "<span>a</span>\n<div/>\n",
    // Code that its formatter rejects is printed as it is written, without what all of its lines are indented by.
    "<p>a</p>\n<script>\n  let a = ;\n\n    b\n</script>\n<p>c</p>\n",
    "<div>\n  <p>a</p>\n  <script>\nlet a = ;  \n\n\n\tb\n  \n  </script>\n  <style>\n      a {\n\n    b\n  </style>\n  <script>let  a</script>\n</div>\n",
    "<script>let a = ;</script>\n<style>a {</style>\n<script>\n\n  let a = ;\n\n</script>\n<script>\n  let  a\n</script>\n",
    // A block of a Vue file that is left alone, in Markdown in a script: a line break in a text would leave the script as it is.
    '<script type="text/markdown">\n  *  a\n\n  ```vue\n  <style lang="stylus">\n  .a\n    color red\n  </style>\n  ```\n</script>\n',
    " a\n",
    "\na\n<b></b>\n",
    "a\n<b></b>\n",
    "<b></b>\n<i>a</i> b\n",
    "<b></b>\n<i>a</i>\n<u>b</u> c\n",
    // Start tags.
    `<div ${attributes}>\n  <p ${attributes}>a</p>\n  <img ${attributes}>\n  <img ${attributes}/>\n  <p ${attributes}></p>\n</div>\n`,
    `<div\n  ${attributes.replaceAll(" ", "\n  ")}\n>\n  <br>\n  <br/>\n  <br />\n</div>\n`,
    '<p A="b" CLASS="c  d" tabIndex="1" onClick="a()" onclick="a( )" [a b]="c" [a="b" a:b="c" :a="b" a:>x</p>\n',
    '<div>\n  <p class=" a"></p>\n  <p class="a  b"></p>\n  <p class=""></p>\n  <p class=" "></p>\n  <p class="{{a}}  b"></p>\n</div>\n',
    '<div>\n  <p style="a:b"></p>\n  <img srcset="a 1x,b 2x">\n  <p srcset="a 1x,b 2x"></p>\n  <iframe allow="a;b"></iframe>\n</div>\n',
    '<div>\n  <p a=\'b\'></p>\n  <p a=b></p>\n  <p a = "b"></p>\n  <p a="b"c></p>\n  <p a="b\nc"></p>\n  <p a="\tb"></p>\n</div>\n',
    '<div>\n  <p a="&amp;"></p>\n  <p a="&quot;"></p>\n  <p a="&apos;"></p>\n  <p a="b&c"></p>\n  <p a="é日本"></p>\n  <p a="{{ b \\" }}"></p>\n</div>\n',
    // `/>` on a line of its own, unless the parent prints the end of its last child.
    `<span>\n<img ${attributes}>\n<b></b></span>\n`,
    `<span>\n<img ${attributes}>\n<b></b>\n</span>\n`,
    // Texts.
    `<div>\n  ${words} ${words}\n  <p>${words} ${words}</p>\n  <span>${words} ${words}</span>\n  <span> ${words} ${words}</span>\n  <span>${words} ${words} </span>\n</div>\n`,
    `<div>\n  <span ${attributes}>${words}</span>\n  <span ${attributes}> ${words} </span>\n  <p ${attributes}>${words}</p>\n</div>\n`,
    "<div>\n  a\n</div>\n",
    `<div>\n  ${words}\n</div>\n`,
    "<div>\n  a\n  <b></b>\n</div>\n",
    "<p>\n  a\n  <p>b</p>\n",
    "<ul>\n  <li>\n    a\n  <li>b\n</ul>\n",
    "<div>\n  a &amp; b &nbsp; &#65; &#x41; &c d\n  <b></b>\n</div>\n",
    "<div>\n  é 日本 語 👍 é   a\n  <b></b>\n</div>\n",
    "<div>\n  {{ a }} {{ b \\\n  <b></b>\n</div>\n",
    "<div>\n  {{ a }} &bogus;\n  <b></b>\n</div>\n",
    "<div>\n  a < b\n  <a: b\n  <b></b>\n</div>\n",
    "<![CDATA[a]]>\nb\n<c></c>\n",
    "<div>\n  a\n  <![CDATA[b]]>\n</div>\n",
    // What is in an element on one line.
    '<div>\n  <p>a <b>b</b> c <i class="d">e</i>, <img src="f"> g</p>\n  <li><a href="#">a</a></li>\n  <p><b><i>a</i></b></p>\n  <p>a<br>b</p>\n  <a><div>b</div></a>\n  <a><div>b</div> c</a>\n</div>\n',
    "<div>\n  <span> <b> a </b> </span>\n  <p> <b> a </b> </p>\n  <p><button> a </button></p>\n  <p><b> </b></p>\n  <p><select></select></p>\n</div>\n",
    // Elements that are not like the others.
    "<div>\n  <pre></pre>\n  <pre>\n</pre>\n  <textarea></textarea>\n  <textarea> </textarea>\n  <title>a</title>\n  <span> </span>\n  <div> </div>\n  <button> </button>\n</div>\n",
    "<table>\n  <tr>a</tr>\n  <tr>\n    <td>a</td>\n  </tr>\n</table>\n<ul>a</ul>\n<select>a</select>\n",
    '<svg>\n  <path d="M0 0"/>\n  <linearGradient id="a"></linearGradient>\n  <text>\n    <tspan>a</tspan>\n  </text>\n  <foreignObject>\n    <p>a</p>\n  </foreignObject>\n  <title>a</title>\n  <g>\n    <use xlink:href="#a"/>\n  </g>\n</svg>\n',
    '<p>\n  <svg class="a"><use xlink:href="#b" /></svg>\n  <svg><g/><g/></svg>\n</p>\n',
    "<DIV>\n  <p>a</p>\n</DIV>\n<div>\n  <P>a</P>\n</div>\n",
    // Comments.
    "<div>\n  <!-- a -->\n  <!--\n    b\n  -->\n  <!--\n    c\n-->\n</div>\n",
    "<div>\n  <p></p>\n  <!--\n    c\n-->\n</div>\n",
    "<div>\n  <!-- prettier-ignore -->\n  <p   a></p>\n  <!-- display: block -->\n  <span>a</span>\n  <!-- prettier-ignore-attribute -->\n  <p   a   b></p>\n  <!--[if IE]><p>a</p><![endif]-->\n</div>\n",
    // The end of the parent.
    "<span>\n  <b></b>\n</span>a\n",
    "<span>\n  <b></b>\n</span\n>\n",
    "<div>\n  <b></b>\n",
    "<div>\n  <b></b>\n</p>\n",
    "<div>\n  <p>a</p\n  >\n</div\n>\n",
    "---\na: b\n---\n\n<div>\n  <p>a</p>\n</div>\n",
    "+++\na = 1\n+++\n\n<div>\n  <p>a</p>\n</div>\n",
    "---\n<p>a</p>\n",
    "+++\n<p>a</p>\n",
    // A text that is written as it is printed, and nearly so.
    `<div>\n  <p>\n    ${full}\n    tempor incididunt\n  </p>\n  ${full}\n  tempor incididunt\n  <b></b>\n</div>\n`,
    `<div>\n  <p>\n    ${full}\n    tempor ${full}\n    tempor\n  </p>\n  <span>\n    ${full}\n    tempor\n  </span>\n</div>\n`,
    `<div>\n  <p>\n    ${full}\n    a tempor\n  </p>\n  <p>\n    ${full} tempor\n    incididunt\n  </p>\n  <p>\n    ${full}\n\n    tempor\n  </p>\n</div>\n`,
    `<div>\n  <p>\n    ${full}\n   tempor\n  </p>\n  <p>\n    ${full}\n     tempor\n  </p>\n  <p>\n    ${full}\n\ttempor\n  </p>\n</div>\n`,
    `<div>\n  <p>\n    ${full}\n    tempor  ut\n  </p>\n  <p>\n    ${full}\n    tempor \n  </p>\n  <p>\n    ${full}\n    tempor &amp; é {{ a }}\n  </p>\n</div>\n`,
    `<div>\n  <p>\n    ${full}\n    tempor <b>a</b>\n  </p>\n  <p>\n    ${full}\n    tempor\n    <b>a</b>\n  </p>\n  <p>\n    ${full}\n    tempor</p>\n</div>\n`,
    `<div>\n  <p>\n    ${full}\n    tempor\n`,
    // What is in a `<head>`.
    `<!doctype html>\n<html>\n  <head>\n    <title>a b</title>\n    <script src="c"></script>\n  </head>\n</html>\n`,
    `<!DOCTYPE html>\n<html>\n  <head>\n    <title> a b </title>\n    <script src="c" defer></script>\n  </head>\n</html>\n`,
    `<!doctype  html>\n<div>\n  <!doctype html>\n  <title>a  b</title>\n  <title>a &amp; b</title>\n  <title>a <b>c</b></title>\n  <title>{{ a }}</title>\n  <title></title>\n</div>\n`,
    `<div>\n  <title>${full} ${full}</title>\n  <script src="${full} ${full}"></script>\n  <script src></script>\n  <script src="a"> </script>\n  <script src="a" />\n  <script ${attributes}></script>\n  <script>\n  </script>\n</div>\n`,
    `<svg>\n  <title>a</title>\n  <script href="b"></script>\n</svg>\n`,
    // White space alone.
    `<div>\n  <a> </a>\n  <a>\n  </a>\n  <a ${attributes}> </a>\n  <a ${attributes}>\n  </a>\n  <p> </p>\n  <button> </button>\n  <a-very-long-name-that-takes-room-and-more-room-and-more-room-and-more-room> </a-very-long-name-that-takes-room-and-more-room-and-more-room-and-more-room>\n</div>\n`,
    // A line break in a value.
    `<div>\n  <p a="b\nc">d</p>\n  <img a="b\n  c" />\n  <p a="b\n">\n    <b>e</b>\n  </p>\n  <p class="b\nc"></p>\n  <p style="b:\nc"></p>\n  <a b="c\nd">e</a>\n  <p>f <a b="c\nd">e</a></p>\n  <p a="b\tc"></p>\n  <p a="b \n c" d="e\n\nf" g></p>\n</div>\n`,
    // Deeper than what is read from the bytes goes.
    "<div>\n".repeat(140) + "<p>a</p>\n" + "</div>\n".repeat(140),
    "﻿<div>\n  <p>a</p>\n</div>\n",
    "<div>\r\n  <p>a</p>\r\n</div>\r\n",
    "<div>\n  <p>a</p>\n</div>",
    "<div>\n  \0<p>a</p>\n</div>\n",
    // Deep.
    Array.from({ length: 40 }, (_, depth) => line(depth, "<div>")).join("") +
      line(40, "<p>a b c</p>") +
      Array.from({ length: 40 }, (_, depth) => line(39 - depth, "</div>")).join(""),
    // `</script` is on the last line of the code, which does not fit with it.
    "<b><script>foo(aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb)</script>x</b>\n",
    // The printer does not count the blank in front of a word that takes no room.
    "b \u0300\n",
    `<div>\n  a \u0300 ${"x".repeat(70)} yyyyy\n  <b></b>\n</div>\n`,
    // Where white space does not count, a line break is printed between a text and an `<svg>`.
    "<rt>;<svg></svg></rt>\n",
    // A form feed is white space, so the end tag behind it, of another element, follows the last child.
    "<ul>\n  <li>\n    <b>a</b>\n    \f</ul>\n",
    // What is on the line that front matter ends on does not start a line.
    "---\n---a\n<v>",
    "---\na:   1\n---\n<div>\n<p>a</p>\n</div>\n",
    "---\na: {\n---\n\n\n<p>a</p>\n",
    "---\na: 1\n--- \n<p>a</p>\n",
    "---\na: 1\n---\n",
    // A comment whose end is where an end tag would be: below the root, in front of a sibling, as the last child.
    "<!--\n  a\n-->\n<p>b</p>\n<!--\n  c\n-->\n",
    "<div>\n  <!--\n    a\n-->\n  <p>b</p>\n</div>\n<p>\n  <!--\n    a\n-->\n  <div>b</div>\n",
    // Without a line break behind it, the last child has no say about the line break in front of it.
    "<a>x</a>\n<b>y</b>",
    "<a>x</a>\n<b>y</b>\n<i>z</i>",
    "<a>x <u>y</u></a>\n<i>z</i>",
    "<div>\n  <p>a</p>\n</div>\n<i>z</i>  ",
    "<!DOCTYPE html>\n<p>a</p>\n",
    "<!DOCTYPE HTML>\n<p>a</p>\n",
    // Words and elements that share lines.
    `<div>\n  <p>${words} <b>bold</b> ${words} <a href="#">link</a>, ${words} (<i>x</i>) ${words}</p>\n  <li class="nav-item mb-2"><a href="#" class="nav-link p-0 text-body-secondary">Frequently asked</a></li>\n</div>\n`,
    `<div>\n  <h1>a</h1>\n  ${words} <b>bold</b> ${words}\n  <a href="#">link</a> ${words}\n  <h1>b</h1>\n  c <i>d</i>\n\n  e <i>f</i>\n</div>\n`,
    `<p>\n  ${full}\n  tempor <b>a</b> ut\n</p>\n<a>${words} <b>bold</b> ${words}</a>\n<a> ${words} <b>bold</b> ${words} </a>\n`,
    // The end of an element without a text at its end is printed in front of the end tag of its parent.
    '<span class="mdc-list-item__primary-text aaaaaaaaaaaaaaaaaaaaaaaaaaaa">{{ label }} <ng-content></ng-content></span>\n',
    // There is no line between `/>` and a word.
    '<div>\n  <input type="checkbox" id="can-drink" [formControl]="canDrinkCtrl" aaaaaaaaaaaa>&nbsp;\n  <label for="can-drink">I am 21 or older</label>\n</div>\n',
    // A blank in front of a line break takes no room.
    "aaaaaaaaa <em>x</em> <x-y>x</x-y> <i/> <a></a>\n",
    // What has a line break on one side only shares a line with its neighbor.
    "\n<em></em><b></b>\n>",
    ">\n<x-y></x-y>é\n",
    '<b>\n)<a f=""></a>\n,\n',
    "\na<i></i>\n<!DOCTYPE>",
    "\n<b></b>;\n\n<",
    // There is a line between a word and `<b></b>`, in the tag.
    "<d>\nééééééé\nccc<b></b> , <em></em>\n\n<",
    // An element with one word in it between two words is a part of the text.
    "<div><code>x</code> , bb<em>xxxxxxxxxxxx</em>. <code></code></div>\n",
    // An element with nothing but an element in it, which does not fit on a line or has an element in it.
    `<div>\n  <li><a class="link-secondary text-decoration-none" ${attributes} href="#">Stuff for developers</a></li>\n  <td><svg class="bi" width="24" height="24"><use xlink:href="#check"/></svg></td>\n  <li><a href="#"><svg class="bi"><use xlink:href="#x"/></svg></a></li>\n  <td><input ${attributes}></td>\n</div>\n`,
    '<a href="#"><svg class="bi"><use xlink:href="#x"/></svg></a>\n<a href="#"> <svg class="bi"><use xlink:href="#x"/></svg> </a>\n<p><b>x\ny</b></p>\n',
    // Without white space, an inline element and its child print parts of each other's tags.
    '<h2><button></button> </h2>\n<span><img a=""> </span>\n<span> <img a=""></span>\n',
    // In `{{ }}` the character behind `//` or a backslash is text, be it the `<` of a tag or the quote of a value.
    "<p>{{//</p>\n",
    '<a b="{{//"></a>\n',
    "\n<span>{{\\</span>\n<e>",
    "<p>{{ a }} b//</p>\n<p>{{ a // </p>\n<p>a//</p>\n<p>{{ a\n//</p>\n",
    '<div\n  hidden\n  a-b\n  c="d"\n  e/>\n<div hidden\ta b/ c>d</div>\n',
    // There are no references in it, and a `<` that starts no tag is text anywhere.
    '<div>\n  {{< placeholder width="200" height="250" background="#55595c" color="#eceeef" text="Thumbnail" >}}\n  <p>{{ a && b ? "c" : "d" }} e &amp; f < g</p>\n  {{ a \\}} &bogus; }} h\n  <b></b>\n</div>\n',
    // Code that is left alone gets the indentation of its element.
    "<div>\n<script>\n      a;\n\n        b;  \n\t\n</script>\n<style>\na {\n  b: c;\n}\n</style>\n<script>a</script>\n<script>\n  a\n</SCRIPT>\n</div>\n",
    "<script>\n\n  a\n\tb\n</script>\n<style>a</style >\n<script>'</script>'</script>\n",
    // Code in a run is handed to its formatter. What cannot be formatted stays, and so does what names its language.
    '<html>\n  <head>\n    <script>\n      const a = `x\n  y`; // c\n      f(aaaaaaaaaaaaaaaaaaaaaaaaaaaa, bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, cccccccccccccccccccc)\n    </script>\n    <style>\n      a{color:red}\n    </style>\n    <meta charset="utf-8">\n  </head>\n</html>\n',
    '<script>\n  (\n</script>\n<style>\n  a {\n</style>\n<script type="text/x">\n  a  b\n</script>\n<script lang="ts">\n  let a:b\n</script>\n<p>c</p>\n',
    "---\na:   1\n---\n<script>a</script>\n<div><script>a</script></div>\n",
    // Words in an element in which white space counts, on one line with its tags.
    `<div>\n  <pre>a b</pre>\n  <pre>a\nb</pre>\n  <pre> a</pre>\n  <pre>{{ a }}</pre>\n  <pre>{{//</pre>\n  <textarea>a b</textarea>\n  <textarea>a  b</textarea>\n  <textarea a="b">${full} ${full}</textarea>\n</div>\n`,
    "<svg>\n  <title>a b</title>\n  <title> a </title>\n  <g></g>\n</svg>\n",
    // The `;` at the end of a `style` is dropped, and a custom property is a property like another.
    `<div>\n  <p style="width: 22%;">a</p>\n  <p style="width: 80%; height: 300px;" ${attributes}>a</p>\n  <p style="--bg-rgb: var(--bs-info-rgb)">a</p>\n  <p style="width: 22%;;">a</p>\n  <p style=";">a</p>\n  <p style="width: 22% ;">a</p>\n  <p>b <i style="width: 1px;">c</i></p>\n</div>\n`,
    // What a comment starts with says whether somebody reads it.
    "<div>\n  <!-- position: x -->\n  <p   a>b</p>\n  <!-- dropstart -->\n  <span>c</span>\n  <!-- 感谢 -->\n  <!-- prettier-ignore -->\n  <p   a>b</p>\n  <!--\vprettier-ignore -->\n  <p   a>b</p>\n</div>\n",
    "<div>\n  <title>{{ a }} b</title>\n  <textarea>{{a}}</textarea>\n  <textarea>a &amp; b</textarea>\n</div>\n",
    // A line break is forced behind a `<br>` that white space follows.
    `<div>\n  <x-y a="b">checked?</x-y><br />\n  <x-y a="b">c</x-y> d<br>\n  e <b>f</b><br> g\n  <p>h<br>i <b>j</b><br /></p>\n  <p>${words}<br>\n  ${words} <b>k</b></p>\n</div>\n`,
    // A text over several lines in front of an element.
    `<p>\n  ${full}\n  tempor ${full}\n  tempor <b>a</b> ut\n</p>\n`,
    // The first child of the text, in front of a child that goes the long way, or has one in it that does: whether a
    // line break is printed behind it is a matter of the two. What is in it is read in any case.
    ...[
      "<div>\n  <p>a</p>\n  <p>b</p>\n</div>",
      "<x-y>\n  <p>a</p>\n  <p>b</p>\n</x-y>",
      "<x-y>\n  <x-z>\n    <b>a</b>\n    <i>c</i\n    ><u>d</u>\n    <b>e</b>\n  </x-z>\n  <p>b</p>\n</x-y>",
      "<span>a</span>",
      "<p>a</p>",
      "a b",
      "{{ a }}",
      `${full}\ntempor`,
      "<!-- a -->",
      "<!doctype html>",
      "<img />",
      "<br />",
      "<svg>\n  <g></g>\n</svg>",
      "<pre>a</pre>",
      "<script>\n  a;\n</script>",
      "<select>\n  <option>a</option>\n</select>",
      "<X-Y>\n  <p>a</p>\n</X-Y>",
    ].flatMap(first =>
      [
        "<div>\n  <i>c</i\n  ><u>d</u>\n  <p>e</p>\n</div>",
        "<x-y>\n  <i>c</i\n  ><u>d</u>\n  <p>e</p>\n</x-y>",
        "<x-y>\n  <p>e</p>\n  <i>c</i\n  ><u>d</u>\n</x-y> f",
        "<i>c</i\n><u>d</u>",
        "<p>c<textarea>\n</textarea></p>",
        "<span>c<textarea>\n</textarea></span>",
        "<!-- prettier-ignore -->\n<p   a>b</p>",
        "<!-- display: inline -->\n<p>b</p>",
        "<!--[if IE]><p>a</p><![endif]-->",
        "c &bogus <u>d</u\n>e",
        "<table>\n  <tr>\n    <td>c<textarea>\n</textarea></td>\n  </tr>\n</table>",
      ].flatMap(second => [
        `${first}\n${second}\n`,
        `${first}\n\n${second}\n<p>g</p>\n`,
        `${first} ${second}\n`,
        `${first}\n${second}`,
      ]),
    ),
    // A run behind a text that goes the long way.
    "a &bogus; b\n<div>\n  <p>c</p>\n  <p>d</p>\n  <i>e</i\n  ><u>f</u>\n  <p>g</p>\n</div>\n<p>h</p>\n",
    "{{ a }}\n<x-y>\n  <div>\n    <p>c</p>\n    <i>e</i\n    ><u>f</u>\n    <p>g</p>\n  </div>\n  <p>h</p>\n</x-y>\n",
    // `/>` on a line of its own in a text that is one run.
    `<img ${attributes}>\n<p>a</p>\n`,
    `<p>a</p>\n<img ${attributes} />\n`,
    `<p>a</p>\n<img ${attributes} />`,
    `a\n<img\n  ${attributes.replaceAll(" ", "\n  ")}\n/>\nb\n`,
    // An element among words that does not fit on a line, so it breaks in itself. The line breaks are in its tags where
    // there is no white space.
    ...[40, 62, 66, 68, 70, 74].flatMap(length => {
      const href = "h".repeat(length);
      return [
        ...["text", words, " text ", "text ", "&lt;x&gt; é 日本"].flatMap(inner =>
          ["", `${full} `, "(", "a\n  "].flatMap(before =>
            ["", ".", ` ${full}`, ", b c", "\n  b", "<b>c</b>"].map(
              after => `<p>\n  ${before}<a href="${href}">${inner}</a>${after}\n</p>\n`,
            ),
          ),
        ),
        ...["", `${full} `, "a"].flatMap(before =>
          ["", " b", `b ${full}`, "\n  b", "<b>c</b>"].flatMap(after => [
            `<span>\n  ${before}<img class="${href}" width="24" alt="" />${after}\n</span>\n`,
            `<span>${before}<img class="${href}" width="24" alt="" />${after}</span>\n`,
            `<div>\n  <p>x</p>\n  ${before}<img class="${href}" width="24" alt="" />${after}\n  <p>y</p>\n</div>\n`,
            `<span>\n  ${before}<img class="${href}" width="24" alt="" />${after}\n  <b></b></span>\n`,
          ]),
        ),
        `<p>\n  a <a href="${href}" target="_blank" rel="license noopener" class="one two three">MIT</a>, docs\n  <code class="${href}">&lt;x&gt;</code>.\n</p>\n`,
        `<p>\n  a\n  <a\n    href="${href}"\n    target="_blank"\n    >MIT</a\n  >, docs\n  <code class="${href}"\n    >&lt;x&gt;</code\n  >.\n</p>\n`,
        `<ul>\n  <li>\n    <del>Deleted</del> text should use\n    <code class="${href}"\n      >&lt;del&gt;</code\n    >\n    and <ins>inserted</ins> text\n  </li>\n</ul>\n`,
        `<p>\n  a <button class="${href}">text</button>. <select class="${href}"><option>b</option></select> c\n</p>\n`,
        `<p>a <a href="${href}">text</a>.</p>\n<p><a href="${href}">text</a>.</p>\n<p>a <a href="${href}">text</a></p>\n`,
        `<span>a <a href="${href}">text</a>.</span>\n<span><a href="${href}">text</a>.</span>\n<span>a <a href="${href}">text</a></span>\n`,
        `<p>\n  a <a href="${href}\n">text</a>. <a\n  href="b">c\n  d</a\n  > e\n</p>\n`,
        `<p>\n  a <br class="${href}" />b <br />${href}${href} <wbr class="${href}">c\n</p>\n`,
      ];
    }),
    // It is a column narrower than it is written if the word behind it prints the `>` of its end tag.
    ...[57, 58, 59, 60, 61, 62].flatMap(length => [
      `<p>\n  ${full}\n  <a href="${"h".repeat(length)}">text</a>. b\n</p>\n`,
      `<p>\n  ${full} <a href="${"h".repeat(length)}">text</a>, b\n  <code class="${"h".repeat(length - 3)}">&lt;x&gt;</code>.\n</p>\n`,
    ]),
    // An inline element around an `<svg>` around one element: each prints a part of the tags of the other.
    ...[1, 20, 24, 26, 28, 30, 32, 34, 60, 80].flatMap(length => {
      const c = "c".repeat(length);
      return [
        ...["a", "span", "button", "x-y", "div"].flatMap(outer =>
          [
            ["", ""],
            [" ", ""],
            ["", " "],
            ["\n      ", ""],
            ["\n      ", "\n    "],
          ].flatMap(([before, after]) =>
            [
              ["", ""],
              [" ", ""],
              ["", " "],
              ["\n    ", "\n  "],
            ].map(
              ([first, last]) =>
                `<li>\n  <${outer} class="x" href="#">${first}<svg class="${c}" width="24">${before}<use xlink:href="#t" />${after}</svg>${last}</${outer}>\n</li>\n`,
            ),
          ),
        ),
        `<li>\n  <a class="${c}" href="#" title="${c}"><svg class="bi" width="24" height="24"><use xlink:href="#${c}"/></svg></a>\n</li>\n`,
        `<li>\n  <a href="#"><svg><use xlink:href="#${c}"></use></svg></a>\n  <a href="#"><svg><path d="${c}" /><path d="M0" /></svg></a>\n  <a href="#"><svg><title>${c}</title></svg></a>\n</li>\n`,
        `<li>\n  <a href="#"><svg class="${c}"><use xlink:href="#t" /></svg></a> b\n  <a href="#"><svg class="${c}"><use xlink:href="#t" /></svg>b</a>\n  <a href="#"><img class="${c}" /></a>\n</li>\n`,
        `<a href="#"><svg class="${c}"><use xlink:href="#t" /></svg></a>\n`,
        `<p>a</p>\n<a href="#"\n  ><svg class="${c}">\n    <use xlink:href="#t" /></svg\n></a>\n<p>b</p>\n`,
        `<svg>\n  <a href="#"><svg class="${c}"><use xlink:href="#t" /></svg></a>\n</svg>\n`,
        `<li>\n  <a href="#"><svg class="${c}"><--- use xlink:href="#t" /></svg></a>\n  <a href="#"><svg class="${c}"><-a /></svg></a>\n  <a href="#"><svg class="${c}"><1 /></svg></a>\n</li>\n`,
        `<li>\n  <a href="#"><svg class="${c}\n"><use xlink:href="#t\n" /></svg></a>\n</li>\n`,
      ];
    }),
    // A `<` with no letter behind it is text.
    ...['<---use a="b" />', "<-a>b</-a>", "<1 />", "<-\n  a />", "<- a", "<_a />"].flatMap(text => [
      `<li>\n  <button class="x">\n    <svg class="cccccccccccccccccccccccc" width="24">${text}\n    </svg>\n  </button>\n</li>\n`,
      `<li>\n  <button class="x"> <svg class="cccccccccccccccccccccccc" width="24">${text}</svg></button>\n</li>\n`,
      `<p>\n  a ${text} b\n  ${text}\n</p>\n<p>${text}</p>\n<span>${text} ${full} ${full}</span>\n${text}\n`,
      `${text}\n<div>\n  <i>c</i\n  ><u>d</u>\n</div>\n`,
    ]),
    // Lines in an element in which white space counts.
    ...["pre", "textarea", "listing", "plaintext", "title", "xmp"].flatMap(name =>
      [
        "\na\nb\n",
        "\na\nb",
        "a\nb\n",
        "a\nb",
        "\n\na\n",
        "\n  a\n    b\n  ",
        "\na  \n  \n\nb\n",
        "\n",
        "\n\n",
        "\n  \n",
        " \na",
        "\na",
        `\n${full} ${full}`,
        full,
        `${full} tempor`,
        ` ${full} `,
        "\na &amp; b\n",
        "\na & b\n",
        "\na \\ b\n",
        "\na { b } {{ c }}\n",
        "\na <b>c</b>\n",
        "\na < b\n",
        "\na\tb\n",
        "\né 日本\n",
        "\na\x0cb\x7f\n",
        "\na</ pre>\n",
      ].flatMap(text => [
        `<div>\n  <${name}>${text}</${name}>\n  <p>c</p>\n</div>\n`,
        `<div>\n  <${name} ${attributes}>${text}</${name}>\n</div>\n`,
        `<${name} class="a">${text}</${name}>\n`,
        `<div>\n  <${name}>${text}</${name}> c\n  <${name}>${text}</${name}\n  >\n  <${name}>${text}</${name} >\n</div>\n`,
        `<span>\n  <${name}>${text}</${name}>\n</span>\n`,
      ]),
    ),
  ];
  const files = Object.fromEntries(inputs.map((input, index) => [`${index}.html`, input]));

  test.concurrent.each([
    [],
    ["--print-width=40"],
    ["--print-width=20", "--tab-width=4"],
    ["--print-width=1"],
    ["--print-width=100000", "--tab-width=0"],
    // The indentation of the deepest input is 12 MB of what is printed.
    ["--tab-width=600"],
    ["--use-tabs"],
    ["--html-whitespace-sensitivity=strict"],
    ["--html-whitespace-sensitivity=ignore", "--print-width=60"],
    ["--bracket-same-line"],
    ["--single-attribute-per-line"],
    ["--embedded-language-formatting=off"],
    ["--end-of-line=crlf"],
  ])("the same with and without short cuts: %j", async (...options: string[]) => {
    const { short, long } = await bothWays(files, options);
    expect(short).toEqual(long);
  });

  test("what is read from the bytes is formatted", async () => {
    const { short } = await bothWays(
      {
        "a.html": `<div   class="a">\n<p>b   c</p>\n\n\n      <img src="d">\n<span  ${attributes}>${words}</span>\n  <!-- e -->\n f\n g\n</div  >\n`,
      },
      [],
    );
    expect(short.written["a.html"]).toMatchInlineSnapshot(`
      "<div class="a">
        <p>b c</p>

        <img src="d" />
        <span
          class="one two three"
          id="an-identifier"
          data-something="a value with words"
          hidden
          >Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod
          tempor incididunt ut labore</span
        >
        <!-- e -->
        f g
      </div>
      "
    `);
    expect(short.exitCode).toBe(0);
  });
});

describe.skipIf(!hasFlag)("Vue", () => {
  // Code that is printed as it is written is not parsed.
  const code = [
    "a",
    "a.b.c",
    "!a",
    "-a",
    "--a",
    "a.b(c, 'd')",
    "a(b)(c)(d)",
    "a?.b",
    "a[b]",
    "a[0]",
    "1",
    "1.50",
    "01",
    "1e3",
    "12345678901234567890",
    "'a'",
    '"a"',
    "'a\\'b'",
    "'é'",
    "a === b",
    "a  === b",
    "a===b",
    "a + b * c",
    "a && b && c",
    "a && b || c",
    "a ?? b",
    "a ? b : c",
    "a ?? b ? c : d",
    "a ? b : c ? d : e",
    "[a, b]",
    "[[a]]",
    "[{ a: b }, { c: d }]",
    "[a,b]",
    "{ a: b }",
    "{a: b}",
    "{ a }",
    "{ false }",
    "{ 'a-b': c }",
    "{ 'a': b }",
    "{ a: b, }",
    "`a ${b} c`",
    "`a\\n`",
    "() => a",
    "(a) => b",
    "a => b",
    "(a, b) => c",
    "(a) => (b = c)",
    "(a) => ({ b })",
    "(a) => a ? b : c",
    "a = b",
    "a.b = c",
    "a() = b",
    "a = b = c",
    "this.a",
    "new A()",
    "typeof a",
    "await a",
    "a as B",
    "true",
    "undefined",
    "(a)",
    "a, b",
    "a; b",
    "a // b",
    "a /* b */",
    "aVeryLongNameThatTakesRoom.anotherVeryLongNameThatTakesRoom(yetAnotherLongName, andOneMore)",
    "f(f(f(f(f(f(f(f(f(f(f(f(f(f(f(f(f(f(f(f(a))))))))))))))))))))",
  ];
  const escaped = (text: string) => text.replaceAll('"', "&quot;");
  const inputs = code.flatMap(it => [
    `<template>\n  <div :a="${escaped(it)}" @b="${escaped(it)}" v-c="${escaped(it)}"></div>\n</template>\n`,
    `<template>\n  <div>\n    <p :a="${escaped(it)}">b</p>\n    <img v-if="${escaped(it)}" />\n    {{ ${it} }}\n    <b style="c:d"></b>\n  </div>\n</template>\n`,
    `<template>\n  <div>{{ ${it} }}</div>\n  <div>a {{${it}}} b</div>\n  <p>a <b>{{ ${it} }}</b></p>\n  <span>{{ ${it} }}é</span>\n</template>\n`,
    `<template>\n  <span>x</span><b :a="${escaped(it)}">y</b>\n  <span><img :a="${escaped(it)}" /></span>\n</template>\n`,
  ]);
  inputs.push(
    ...[
      "a in b",
      "(a, b) in c",
      "(a, b, c) of d",
      "(a) in b",
      "{ a, b } in c",
      "({ a }, b) in c",
      "a  in b",
      "a in b.c(d)",
      "true in a",
    ].map(it => `<template>\n  <div v-for="${it}">a</div>\n</template>\n`),
    ...["a", "{ a }", "{ a, b }", "{a}", "{ a: b }", "{ a = 1 }", "a, b", "", "true"].map(
      it =>
        `<template>\n  <a>\n    <template #b="${it}">c</template>\n    <template v-slot:d="${it}">e</template>\n  </a>\n</template>\n`,
    ),
    "<template>\n  <ElButton>\n    <Foo />\n    <Li>a</Li>\n    <Button>b</Button>\n  </ElButton>\n</template>\n",
    '<template>\n  <div v-pre>\n    <p :a="b   +c">{{d   +e}}</p>\n  </div>\n</template>\n',
    "<template>\n  <div>{{  }}</div>\n  <div>{{}}</div>\n</template>\n",
    "<template>\n  <ul>\n    <li></li>\n    {{ a }}\n    b\n  </ul>\n  <ol>\n    {{ a }}\n  </ol>\n  <table>\n    {{ a }}\n    <tr></tr>\n  </table>\n  <select>\n    <option>a</option>\n    {{ a }}\n  </select>\n</template>\n",
    "<template>\n  <div>\n    {{ a }}\n  </div>\n  <span>\n    {{ a }}\n    <b></b>\n  </span>\n  <p>\n    {{ a }}\n    b\n  </p>\n  <p>\n    {{ a }} b\n  </p>\n</template>\n",
    "<template>\n  <p>a</p>\n</template>\n\n<script>\nlet a\n</script>\n\n<style>\na{b:c}\n</style>\n",
    '<template lang="pug">\np a\n</template>\n\n<template>\n  <p>a</p>\n</template>\n',
    "<custom>\n  <p>\n</custom>\n\n<template>\n  <p>a</p>\n</template>\n",
    "<template>\n  <p>a</p>\n</template>\n<br>\n",
    '<!doctype html>\n<html>\n  <body>\n    <p A="b">c</p>\n  </body>\n</html>\n',
    // In a `<foreignObject>`, which need not be in an `<svg>`, an `<svg>` and what is in it are inline.
    "<template>\n  <foreignObject>\n    <svg> </svg>\n  </foreignObject>\n</template>\n",
    "<template>\n  <svg>\n    <foreignObject>\n      <div>\n        <svg> </svg>\n        <svg>\n          <g> </g>\n        </svg>\n      </div>\n    </foreignObject>\n  </svg>\n</template>\n",
    // What is in it is on the line of its last attribute.
    `<template>\n  <xmp :a="b">${"x".repeat(60)} <b>c</b></xmp>\n</template>\n`,
    // A comment says that the element is a table, in which no group is around a child.
    "<template>\n  <!-- display: table -->\n  <div>\n    {{ a }}\n    b\n  </div>\n</template>\n",
    // `{{ }}` is a node of its own, so a line break next to it is more than white space in a text.
    "<template><e>\n}\n{{x}}<b></b>\n<div>",
    '<template>\n<label a="">{{x}}\nd\n</label>\n>',
    "<template>\n<code></code>{{x}}\n;\n<div>",
    "<template>\n  <p>a {{ b }} <i>c</i> dddddddddd eeeeeeeeee ffffffffff</p>\n  g <i>h</i> iiiiiiiiii jjjjjjjjjj kkkkkkkkkk\n  <p>l</p>\n</template>\n",
    // A `<` that starts no tag goes on with the text.
    "<template><h>\n}<code></code>\n>\n<",
    "<template>\n  <title>{{a}}</title>\n  <textarea>{{a}}</textarea>\n</template>\n",
  );
  const files = Object.fromEntries(inputs.map((input, index) => [`${index}.vue`, input]));

  test.concurrent.each([
    [],
    ["--print-width=40"],
    ["--print-width=20", "--tab-width=4"],
    ["--single-quote", "--no-bracket-spacing", "--arrow-parens=avoid"],
    ["--quote-props=consistent"],
    ["--quote-props=preserve", "--use-tabs"],
    ["--bracket-same-line", "--print-width=30"],
    ["--embedded-language-formatting=off"],
  ])("the same with and without short cuts: %j", async (...options: string[]) => {
    const { short, long } = await bothWays(files, options);
    expect(short).toEqual(long);
  });

  test("classes in code that is written as it is printed are sorted", async () => {
    const { short, long } = await bothWays(
      {
        "node_modules/tailwindcss/package.json": `{ "name": "tailwindcss", "version": "4.0.0", "main": "index.js" }`,
        "node_modules/tailwindcss/theme.css": "",
        "node_modules/tailwindcss/index.js": `exports.__unstable__loadDesignSystem = async () => ({\n  getClassOrder: classes => classes.map(name => [name, BigInt(["m-2", "flex", "p-4"].indexOf(name))]),\n});\n`,
        "a.vue": `<template>\n  <p @click="cn('p-4 flex m-2')" v-for="a in cn(\`p-4 flex m-2\`)">b</p>\n</template>\n`,
      },
      ["--sort-tailwindcss"],
    );
    expect(short).toEqual(long);
    expect(short.written["a.vue"]).toContain("cn('m-2 flex p-4')");
  });
});

describe.skipIf(!hasFlag)("the blocks of a Vue file", () => {
  const template = '<template>\n  <div :a="b">\n    <p>{{ c }}</p>\n  </div>\n</template>\n';
  const script = '<script setup lang="ts">\nimport { a } from "a";\nconst b   = a<number>(1)\n</script>\n';
  const style = "<style scoped>\n.a{color:red}\n\n\n.b {\n  color: blue;\n}\n</style>\n";
  const inputs = [
    template,
    script,
    style,
    `${template}\n${script}\n${style}`,
    `${script}\n${template}\n${style}`,
    `${script}${template}${style}`,
    `${script}\n\n\n${template}\n\n\n\n${style}\n\n`,
    `${template}\n${script}\n${style}`.trimEnd(),
    // A block that takes a document, or that its formatter rejects, among blocks that do not.
    ...[
      "<script>\nlet a = ;\n\n  b\n</script>\n",
      "<script>\n  let a = ;  \n\n\n\tb\n \n</script>\n",
      '<script lang="ts">\nlet a: = 1;\n</script>\n',
      "<script>\nlet  a = css`a{b:c}`\n</script>\n",
      "<script>\nlet  a = '<!--'\n</script>\n",
      "<style>\na {\n\n  b\n</style>\n",
      '<style lang="scss">\n/* a\n\n b */\na{b:c}\n</style>\n',
    ].flatMap(block => [
      block,
      `${script}\n${block}\n${style}`,
      `${block}\n${script}\n${template}`,
      `${template}\n${block}\n${block}\n${script}`,
    ]),
    // An end tag that closes nothing, which is no error next to an element without an end tag.
    '<template lang="pug">\n<template></template>\n<input />\n<!-- prettier-ignore -->\n</template>\n\n\n<style lang="scss">\na{}\n</style>\n\n\n<!-- c -->\n',
    '<template lang="pug">\n<template></template>\n<input />\n<!-- display: block -->\n\n</template>\n<style>\na{}\n</style>\n\n\n<p>c</p>\n',
    `${template}\n${script}`.trimEnd(),
    `\n${template}\n${script}`,
    `﻿${template}\n${script}`,
    `---\na:   1\n---\n\n${template}\n${script}`,
    `<!-- a -->\n${template}\n<!-- b -->\n${script}<!-- c -->\n`,
    // A comment that somebody reads.
    `${template}\n<!-- prettier-ignore -->\n${script}\n<!-- display: inline -->\n${style}`,
    // With one of these, the text is HTML.
    `<!doctype html>\n${template}\n${script}`,
    `${template}\n${script}\n<html></html>\n`,
    // Other blocks, and what is no block.
    `${template}\n<i18n>\n{ "a":1 }\n</i18n>\n\n${script}`,
    `${template}\n<i18n lang="json">\n{ "a":1 }\n</i18n>\n\n${script}`,
    `<docs>\n<div>\n</docs>\n\n${template}\n${script}`,
    `${template}\ntext\n${script}`,
    `${template}\n{{ a }}\n${script}`,
    `${template}\n<br>\n${script}`,
    `<div>\n  <p>a</p>\n</div>\n\n${script}`,
    // What is on the line of a tag.
    `${template.trimEnd()} ${script}`,
    `${template.trimEnd()}a\n${script}`,
    `${script.trimEnd()}<b></b>\n${template}`,
    // A `<template>` that is not broken, is empty, is in another language, has attributes.
    "<template>a</template>\n",
    "<template>\n  a\n</template>\n",
    "<template>\n  a\n  <div></div>\n</template>\n",
    "<template>\n  a\n\n  <div></div>\n</template>\n",
    "<template>\n  a <b>c</b>\n  <div></div>\n</template>\n",
    "<template>\n  a\n  b\n  <div></div>\n</template>\n",
    "<template>\n  a\n  {{ b }}\n</template>\n",
    // An empty block has its end tag on the line of its start tag.
    "<style scoped></style>\n",
    '<script lang="ts" setup></script>\n<style>\na {\n}\n</style>\n',
    '<script lang="ts"></script>\n\n<template>\n  <p :a="b  as c"></p>\n</template>\n',
    "<script setup></script >\n",
    "<script setup> </script>\n",
    "<script setup></script>a\n",
    "<template>\n  {{ a }}\n</template>\n",
    "<template>\n  <!-- a -->\n</template>\n",
    "<template>\n  <b>a</b> c\n</template>\n",
    "<template>\n  <b>a</b>\n</template>\n",
    "<template><div></div></template>\n",
    "<template>\n  <div></div></template>\n",
    "<template><div></div>\n</template>\n",
    "<template></template>\n",
    "<template>\n</template>\n",
    "<template />\n",
    "<template>\n<div></div>\n    <p>a</p>\n</template>\n",
    "<template>\n  <template>\n    <p>a</p>\n  </template>\n  <template #a>b</template>\n</template>\n",
    '<template lang="pug">\ndiv\n  p a\n</template>\n',
    '<template lang="html">\n  <div></div>\n</template>\n',
    "<template functional>\n  <div></div>\n</template>\n",
    "<template>\n  <div></div>\n</template >\n",
    "<Template>\n  <div></div>\n</Template>\n",
    "<template>\n  <div></div>\n",
    "<template>\n  <div v-pre>{{ a  }}</div>\n</template>\n",
    // Whether an expression is TypeScript is a matter of a `<script>`, wherever it is.
    `<template>\n  <div :a="b as c" @d="(e: f) => g!"></div>\n</template>\n\n<script lang="ts">\na;\n</script>\n`,
    `<script lang="ts">\na;\n</script>\n\n<template>\n  <div :a="b as c" @d="(e: f) => g!"></div>\n</template>\n`,
    `<script lang="typescript">\na;\n</script>\n\n<template>\n  <div :a="b as c"></div>\n</template>\n`,
    `<script lang="tsx">\na;\n</script>\n\n<template>\n  <div :a="b as c"></div>\n</template>\n`,
    `<script>\na;\n</script>\n\n<template>\n  <div :a="b as c"></div>\n</template>\n`,
    // The attributes of a block.
    ...[
      "",
      " setup",
      ' lang="ts"',
      ' lang="tsx"',
      ' lang="js"',
      ' lang="jsx"',
      ' lang="typescript"',
      ' lang="coffee"',
      ' lang="json"',
      ' lang=""',
      " lang",
      " lang='ts'",
      " lang=ts",
      ' LANG="ts"',
      ' lang="ts" lang="js"',
      '  setup   lang="ts"',
      '\n  setup\n  lang="ts"\n',
      ' setup="props"',
      ' setup="{ a,b }"',
      ' lang="ts" generic="T extends  U"',
      ' type="module"',
      ' src="./a.js"',
      " src",
      ' :a="b"',
      ' class="b  a"',
      ` setup lang="ts" name="${"a".repeat(70)}"`,
      ` setup ${"a".repeat(40)} ${"b".repeat(40)}`,
    ].map(attributes => `<script${attributes}>\nconst a   = <T,>(b: T) => b\n</script>\n\n${template}`),
    ...[
      "",
      " scoped",
      " module",
      ' lang="css"',
      ' lang="scss"',
      ' lang="less"',
      ' lang="postcss"',
      ' lang="stylus"',
      ' lang="sass"',
      ' lang="ts"',
      ' module="a"',
      ' vars="{a,b}"',
      ' src="a.css"',
      ' scoped=""',
    ].map(attributes => `${template}\n<style${attributes}>\n.a{.b{color:red}}\n// c\n</style>\n`),
    // What is in a `<script>`.
    ...[
      "",
      "\n",
      " ",
      "a",
      "\na",
      "a\n",
      "\n\n\na\n\n\n",
      "\n  a;\n  b;\n",
      "\na;  \n",
      "\na(\n",
      "\n// prettier-ignore\na  =  1;\n",
      "\nconst a = `\n  b\n`;\n",
      "\n/*\n a\n  */\n",
      "\n<!-- a\n",
      "\n// @flow\na;\n",
      '\nconst a = "</script";\n',
      '\nconst a = "<script>";\n',
      "\na </ b;\n",
      "\na;\r\nb;\r\n",
      "\na;\f\n",
      "\n﻿a;\n",
      '\nconst a = "中";\n',
      "\nconst a = css`\n  a {\n  }\n`;\n",
      "\nreturn a;\n",
      "\nawait a;\n",
      "\nconst a = <div />;\n",
      `\nconst ${"a".repeat(30)} = ${"b".repeat(30)}(${"c".repeat(30)}, ${"d".repeat(30)});\n`,
    ].flatMap(code => [`<script>${code}</script>\n`, `${template}\n<script lang="ts">${code}</script>\n`]),
    "<script>\na;\n</script >\n",
    "<script>\na;\n</SCRIPT>\n",
    "<script>\na;\n</script\n>\n",
    "<script>\na;\n",
    "<script />\n",
    // What is in a `<style>`.
    ...[
      "",
      "\n",
      "a{}",
      "\n  a {\n    b: c;\n  }\n",
      "\n/*\n a  \n  */\n",
      "\n/* a */  \n",
      '\na {\n  b: "c\\\nd";\n}\n',
      "\na {\n",
      "\n}\n",
      "\na {\n  b: c;\r\n}\n",
      "\n/* prettier-ignore */\na  {\n}\n",
      "\n---\na: 1\n---\na {\n}\n",
      "\na {\n  b: v-bind('c.d');\n}\n",
      `\n${"a".repeat(30)}, ${"b".repeat(30)}, ${"c".repeat(30)} {\n  d: e;\n}\n`,
      "\n</styl>\n",
    ].flatMap(code => [`<style>${code}</style>\n`, `${template}\n<style lang="scss">${code}</style>\n`]),
  ];
  const files = Object.fromEntries(inputs.map((input, index) => [`${index}.vue`, input]));

  test.concurrent.each([
    [],
    ["--vue-indent-script-and-style"],
    ["--vue-indent-script-and-style", "--use-tabs"],
    ["--vue-indent-script-and-style", "--tab-width=0"],
    ["--vue-indent-script-and-style", "--embedded-language-formatting=off"],
    ["--embedded-language-formatting=off"],
    ["--html-whitespace-sensitivity=strict"],
    ["--html-whitespace-sensitivity=ignore"],
    ["--print-width=20"],
    ["--print-width=1", "--tab-width=4"],
    ["--end-of-line=crlf"],
    ["--end-of-line=cr", "--vue-indent-script-and-style"],
    ["--no-semi", "--single-quote", "--use-tabs"],
    ["--bracket-same-line"],
    ["--single-attribute-per-line", "--print-width=30"],
    ["--insert-pragma"],
    ["--require-pragma"],
  ])("the same with and without short cuts: %j", async (...options: string[]) => {
    const { short, long } = await bothWays(files, options);
    expect(short).toEqual(long);
  });

  test("no block is formatted twice where another one takes a document", async () => {
    const refused = "<script>\nlet  a = css`a{b:c}`\n</script>\n";
    const rejected = "<script>\nlet a = ;\n</script>\n";
    for (const [text, flags, taken, asked] of [
      [`${script}\n${refused}\n${style}`, [], 1, 2],
      [`${script}\n${rejected}\n${style}`, [], 1, 2],
      [`${refused}\n${script}`, [], 1, 2],
      [`${script}\n${style}`, ["--vue-indent-script-and-style"], 1, 1],
    ] as const) {
      using dir = tempDir("fmt-short-cuts", { "a.vue": text });
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "fmt",
          "--check",
          "--bench=1",
          "--threads=1",
          "--no-config",
          "--no-editorconfig",
          ...flags,
          "a.vue",
        ],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const said = (await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited])).slice(0, 2).join("");
      const counts = [...said.matchAll(/^(the quick way|  refused, \w+): (\d+) scripts/gm)].map(match =>
        Number(match[2]),
      );
      expect({ text, taken: counts[0], asked: counts.reduce((sum, count) => sum + count, 0) }).toEqual({
        text,
        taken,
        asked,
      });
    }
  });

  test("a file that is read from the bytes is formatted", async () => {
    const { short, long } = await bothWays({ "a.vue": `${script}\n\n\n${template}${style}` }, []);
    expect(short).toEqual(long);
    expect(short.written["a.vue"]).toMatchInlineSnapshot(`
      "<script setup lang="ts">
      import { a } from "a";
      const b = a<number>(1);
      </script>

      <template>
        <div :a="b">
          <p>{{ c }}</p>
        </div>
      </template>
      <style scoped>
      .a {
        color: red;
      }

      .b {
        color: blue;
      }
      </style>
      "
    `);
  });
});

describe.skipIf(!hasFlag)("code in a Vue file that is read from the bytes", () => {
  const wide = "a".repeat(30);
  const values = [
    "a  +  b",
    "(a)",
    "a ? (b) : c",
    "[a,b]",
    `[${wide}, ${wide}, ${wide}]`,
    `[\n  ${wide},\n  b]`,
    "{a:b}",
    "{\n  a: b }",
    `{ a: ${wide}, b: ${wide}, c: ${wide} }`,
    `${wide}(${wide}, ${wide}, ${wide})`,
    `${wide} || ${wide} || ${wide} || ${wide}`,
    `${wide} ? ${wide} : ${wide} + ${wide}`,
    "(a) => b(a)",
    "a => { b(a) }",
    "(a) => {\n  b(a);\n  c();\n}",
    "a = b; c = d",
    "a()",
    "a as b",
    "a!",
    "(a: b) => c",
    "<a>b",
    "a | b",
    "a | b(c)",
    "`a${ b }`",
    "`a\n${b}`",
    "'a' + \"b\"",
    "'a\\'b'",
    "a && b",
    "(a || b) && c",
    "a &amp;&amp; b",
    "a &foo; b",
    // A reference without a name, without digits, or to no character is an error of the host.
    "'&;'",
    "'&#;'",
    "'&#x;'",
    "'&#x110000;'",
    "'&#1;' + a  ",
    "'&nbsp' + a  ",
    "'&nbsp;' + a  ",
    "a &b",
    "a & b",
    "a &&= b",
    "a &quot;b&quot;",
    "a // b",
    "a /* b */",
    "{{ a }}",
    "a }} b",
    "a\tb",
    "'é' + a  ",
    "'中文' +  a",
    "",
    " ",
    "a b",
    "(",
    "function () {}",
    "async () => await a",
    "/a\\d/.test(b)",
    "$emit('a',  b)",
  ];
  const names = [
    ":a",
    ".a",
    "v-bind:a",
    "v-bind",
    "v-if",
    "v-model",
    "v-html",
    "@a",
    "v-on:a",
    "@a.b",
    ":[a]",
    "v-for",
    "#a",
    "v-slot:a",
    "slot-scope",
    "a",
    "onclick",
  ];
  // What is in front of a colon can be a namespace, and then the name that counts is another one than is written.
  names.push("::a", ":a:b", ":a::b", "@a:b", "@:a", ".a:b", "a:b", "a::b", "v:a", "v-bind::a", "v-on::a", ":::a");
  const scripts = [
    "",
    '\n<script setup lang="ts">\nlet a;\n</script>\n',
    "\n<script setup lang='ts'>\nlet a;\n</script>\n",
    '\n<script lang="typescript">\nlet a;\n</script>\n',
    '\n<script lang="tsx">\nlet a;\n</script>\n',
    "\n<script>\nlet a = '<script lang=\"ts\">';\n</script>\n",
    '\n<!-- <script lang="ts"> -->\n<script>\nlet a;\n</script>\n',
    '\n<docs>\n<script lang="ts">\n</script>\n</docs>\n',
    '\n<script lang="ts" src="a">\n</script>\n',
  ];
  const inputs = [
    ...values.flatMap(value =>
      names.map(
        name => `<template>\n  <div>\n    <p b="c" ${name}="${value}" d>e</p>\n  </div>\n</template>\n${scripts[1]}`,
      ),
    ),
    ...values.map(
      value =>
        `<template>\n  <div>\n    {{ ${value} }}\n    <p>{{${value}}}</p>\n    <p>a {{ ${value} }} b</p>\n  </div>\n</template>\n${scripts[1]}`,
    ),
    // Whether the code is TypeScript.
    ...scripts.flatMap(script => [
      `<template>\n  <p :a="b  as c" @d="(e: f) => g!">{{ h  as i }}</p>\n</template>\n${script}`,
      `${script.trimStart()}\n<template>\n  <p :a="b  as c" @d="(e: f) => g!">{{ h  as i }}</p>\n</template>\n`,
      // With something that goes the long way behind the code.
      `<template>\n  <p :a="b  as c">{{ h  as i }}</p>\n  <p #j="{ k: { l } }"></p>\n</template>\n${script}`,
    ]),
    // Where the attribute is, and what follows it.
    ...[
      '<p :a="[b,c]"></p>',
      '<p :a="[b,c]" />',
      '<p\n  :a="[b,c]"\n/>',
      `<p :a="[${wide},${wide},${wide}]" />`,
      `<p :a="[${wide},${wide},${wide}]">d</p>`,
      `<p :a="[${wide},${wide},${wide}]"\n  >d</p\n>`,
      `<span :a="[${wide},${wide},${wide}]">d</span>`,
      `<span :a="[${wide},${wide},${wide}]"><b>d</b></span>`,
      `<component-with-a-long-name :a="[${wide},${wide}]" />`,
      `<i :a="[${wide},${wide}, b]" />`,
      `<pre :a="[${wide},${wide},${wide}]">d</pre>`,
      '<pre :a="[b,c]">d</pre>',
      '<textarea :a="[b,c]"></textarea>',
      `<textarea :a="[${wide},${wide},${wide}]"></textarea>`,
      '<svg :a="[b,c]"><g :d="[e,f]"></g></svg>',
      'a <b :c="[d,e]">f</b> g',
      `a <b :c="[${wide},${wide},${wide}]">f</b> g`,
      '<input :a="[b,c]">',
      '<br :a="[b,c]" /><br :a="[b,c]" />',
    ].flatMap(element => [
      `<template>\n  ${element}\n</template>\n`,
      `<template>\n  <div>\n    <div>\n      ${element}\n    </div>\n  </div>\n</template>\n`,
      `<template>\n  <span>${element}</span>\n</template>\n`,
    ]),
    // A `style` attribute, whatever is between its declarations.
    ...[
      "color: red;width: 1px",
      "color: red ; width: 1px",
      "\n  color: red;\n  width: 1px;\n",
      "\n  color: red;\n\n  width: 1px;\n",
      "\n\n  color: red;\n",
      "color: red;;",
      "color: red;\twidth: 1px",
      `\n  color: var(--${wide});\n  width: 1px;\n  background: rgba(0, 0, 0, 0.5);\n`,
      `color: var(--${wide}); width: 1px; background: rgba(0, 0, 0, 0.5); height: 100%`,
      `color: var(--${wide}${wide}${wide})`,
      `margin: ${"1px ".repeat(30)}1px`,
      "color: red; /* a */ width: 1px",
      "color: RED;\n width: 1px",
      "color: red;\n font-family: a, b",
      "--a: b;\n color: red",
      "",
      "\n",
      ";",
    ].flatMap(value => [
      `<template>\n  <div>\n    <p a="b" style="${value}" c>d</p>\n  </div>\n</template>\n`,
      `<template>\n  <i style="${value}" />\n  <component-with-a-long-name style="${value}" />\n</template>\n`,
    ]),
    // What is not as wide as it is long, next to `{{ }}`.
    ...[
      "Value：{{ a }}",
      "{{ a + 1 }}期",
      "中{{ a }}文{{ b }}字",
      "é{{ a }}",
      "́{{ a }}",
      "{{ a }}́",
      "{{ a }}️⃣",
      "😀{{ a }}😀 b",
    ].flatMap(words => [
      `<template>\n  <div class="demonstration">${words}</div>\n</template>\n`,
      `<template>\n  <p>${words} ${words} ${words} ${words}</p>\n  <span>c ${words}</span>\n</template>\n`,
      `<template>\n  <div>\n    ${words}\n  </div>\n</template>\n`,
    ]),
    // `{{ }}` that does not fit on its line: the braces stay with the tags of an inline element that has no white space
    // in it, if the start tag fits together with them.
    ...["a", wide, `t('${wide}')`, `t("${wide}")`, `${wide} + ${wide}`, `f(${wide}, ${wide})`, `${wide}  .b`].flatMap(
      code => [
        `<template>\n  <span class="b">{{ ${code} }}</span>\n  <span>{{${code}}}</span>\n  <i ${wide}>{{ ${code} }}</i>\n</template>\n`,
        `<template>\n  <div class="b">{{ ${code} }}</div>\n  <span> {{ ${code} }} </span>\n  <span> {{ ${code} }}</span>\n  <span>{{ ${code} }} </span>\n</template>\n`,
        `<template>\n  <div>\n    {{ ${code} }}\n  </div>\n  <span>{{\n    ${code}\n  }}</span>\n  <ul>\n    {{ ${code} }}\n  </ul>\n  {{\n    ${code}\n  }}\n</template>\n`,
        `<template>\n  <span>{{ ${code} }}{{ ${code} }}</span>\n  <span>c{{ ${code} }}</span>\n  <span><b>{{ ${code} }}</b></span>\n</template>\n`,
      ],
    ),
    // `v-for`: names on the left side, code on the right side.
    ...[
      "a in b+c",
      "a  in  b+c",
      "a of [b,c]",
      "(a, b) in c.d( e )",
      "(a,b) in c+d",
      "( a , b ) in c+d",
      "(a, b, c) of d+e",
      "(a, b, c, d) in e+f",
      "(a) in b+c",
      "a, b in c+d",
      "(a, a) in b+c",
      "true in b+c",
      "of in b+c",
      "{ a, b } in c+d",
      "{ a: b } in c+d",
      "[a, b] in c+d",
      "({ a }, b) in c+d",
      "a in",
      "in b+c",
      "a in b in c+d",
      "(a, b in c+d",
      "() in b+c",
      "(, a) in b+c",
      "a\n in\n b+c",
      "a in b && c",
      "a in b as c",
      `(a, b) in ${wide}.slice(${wide}, ${wide})`,
      `(${wide}, ${wide}) in c.d( e )`,
      `item in ${wide}.concat([{} as any], ${wide})`,
    ].flatMap(value => [
      `<template>\n  <div>\n    <p v-for="${value}" :key="a">b</p>\n  </div>\n</template>\n${scripts[1]}`,
      `<template>\n  <component-with-a-long-name v-for="${value}" />\n  <i v-for="${value}" />\n</template>\n`,
    ]),
    // A comment that starts with a tag is a comment like another, unless it ends a conditional comment.
    ...[
      "<!-- <a> -->",
      "<!--<a b>-->",
      "<!-- <a\n  b\n/> -->",
      "<!--<![endif]-->",
      "<!--<! [endif]-->",
      "<!-- <![endif] -->",
      "<!--<-->",
      "<!--<!-->",
    ].map(comment => `<template>\n  ${comment}\n  <div>\n      ${comment}\n    <p   a>b</p>\n  </div>\n</template>\n`),
    // Code behind something that goes the long way.
    `<template>\n  <p #a="{ b: { c } }"></p>\n  <p :d="[e,f]" :g="[${wide},${wide},${wide}]">{{ h  ( i ) }}</p>\n</template>\n`,
    `<template>\n  <div>\n    <p #a="{ b: { c } }"></p>\n    <p :d="e  as f">{{ g  as h }}</p>\n  </div>\n</template>\n\n<script lang="ts">\ni;\n</script>\n`,
    // A tab is as wide as the options say, which matters on one line.
    ...["M1,2\n\tz", "M1,2\tz", "\tM1\n", "a\t\nb"].flatMap(value =>
      ["d", "class", ":d", "title"].map(name => `<template>\n  <path a="b" ${name}="${value}" />\n</template>\n`),
    ),
  ];
  const files = Object.fromEntries(inputs.map((input, index) => [`${index}.vue`, input]));

  test.concurrent.each([
    [],
    ["--print-width=40"],
    ["--print-width=20", "--tab-width=4"],
    ["--print-width=60", "--tab-width=8"],
    ["--print-width=1"],
    ["--print-width=100000", "--tab-width=0"],
    ["--use-tabs", "--print-width=60"],
    ["--single-quote", "--no-bracket-spacing", "--arrow-parens=avoid", "--no-semi"],
    ["--quote-props=consistent", "--trailing-comma=none"],
    ["--object-wrap=collapse", "--experimental-operator-position=start"],
    ["--experimental-ternaries"],
    ["--html-whitespace-sensitivity=strict"],
    ["--html-whitespace-sensitivity=ignore", "--print-width=60"],
    ["--bracket-same-line", "--print-width=60"],
    ["--single-attribute-per-line"],
    ["--embedded-language-formatting=off"],
    ["--end-of-line=crlf"],
    ["--vue-indent-script-and-style"],
  ])("the same with and without short cuts: %j", async (...options: string[]) => {
    const { short, long } = await bothWays(files, options);
    expect(short).toEqual(long);
  });

  // 1 in a release build, and 60 when each `<script` looked for the `>` behind all of them.
  test("whether the code is TypeScript is found out in one pass", async () => {
    const count = isDebug || isASAN ? 16_000 : 64_000;
    const text = `<template>\n  <div :a="b  +  c"></div>\n  <!-- ${"<script ".repeat(count)} -->\n</template>\n`;
    expect(await slowdownByShortCuts("a.vue", text)).toBeLessThan(6);
  });

  test("code in a file that is read from the bytes is formatted", async () => {
    const { short, long } = await bothWays(
      {
        "a.vue": `<template>\n  <div :a="[b,c]" style="\n color: red;width: 1px;">\n    <p :class="[${wide},${wide}, d  as e]">{{ f  ( g ) }}</p>\n  </div>\n</template>\n\n<script lang="ts">\nh\n</script>\n`,
      },
      [],
    );
    expect(short).toEqual(long);
    expect(short.written["a.vue"]).toMatchInlineSnapshot(`
      "<template>
        <div :a="[b, c]" style="color: red; width: 1px">
          <p
            :class="[
              aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,
              aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,
              d as e,
            ]"
          >
            {{ f(g) }}
          </p>
        </div>
      </template>

      <script lang="ts">
      h;
      </script>
      "
    `);
  });
});

describe.skipIf(!hasFlag)("where lines are written without a document", () => {
  /** Formats `files` with `flags`, and returns what they are afterwards. */
  async function format(files: Record<string, string>, flags: string[]) {
    using dir = tempDir("format-short-cuts", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fmt", "--write", "--no-editorconfig", "--log-level=silent", ...flags, "."],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    const texts = Object.fromEntries(
      Object.keys(files).map(name => [name, readFileSync(join(String(dir), name), "utf8")]),
    );
    return { texts, stderr, exitCode };
  }

  const files: Record<string, string> = {
    // A block comment that is printed on the line of what is before it counts for the width, wherever it is written.
    "comment-after-stray-semicolon.js": `import { aaaaaaaaaaaaaaaaaaa, bbbbbbbbbbbbbbbbbbbbbbbb } from "./cccccccccccccc";\n;/** The comment is on that line */\nd();\n`,
    "comment-after-comma-on-next-line.js": `a = {\n  bbbbbbbbbbb: cccccccccccccc.dddddddddddd(eeeeeeeeeeeeeeee.ffffffffff).ggggggggg\n,/* istanbul ignore next */\n  h: 1,\n};\n`,
    "comment-after-statement.js": `aaaaaaaaaaaaaaaaaaaaaaaaaaa(bbbbbbbbbbbbbbbbbbbbbbbbbbbbb, ccccccccccccccccccc); /* d */\ne(); /* f */ g();\n`,
    // What is printed to a text of its own does not start where the file says.
    "each-table.js":
      "test.each`\na | \n${[{ start: 1, end: 3 },{  // c\nstart: 15, end: 20 }]}| \n`('example test', ({a, b, c}) => {})\n",
    // Flow: the nodes of TypeScript stand for something else.
    "flow-types.js": `// @flow\nfunction f<T: Object = {}>(a: ?string, b: Array<number>, c: A.B<C> | 'd', ...e?: bool[]): boolean {\n  return (a: any);\n}\nconst x: ?Foo = ((y: any): ?(Bar[]));\nclass A<+T> extends B<T> implements C {\n  +a: number;\n  static b: ?T = null;\n  c(d: A<>): (?T)[] {\n    return [];\n  }\n}\n`,
    "flow-declarations.js": `// @flow\nimport typeof A from "a";\nimport { typeof B, type C } from "b";\nimport type D from "d";\ndeclare var z: number;\ndeclare function g(number): string;\ndeclare export default T;\ndeclare module.exports: { a: 1 };\ndeclare export { a };\nopaque type E = string;\nhook useF() {\n  return 1;\n}\ncomponent G(a: T) {\n  return a;\n}\n`,
    "flow-declare-module.js": `// @flow\ndeclare module 'a' {\n  class B extends C {\n    constructor(d?: E): void;\n    f(): void;\n  }\n  function g(): void;\n  export default class H<I> {\n    j: I;\n  }\n}\n`,
    "flow-match.js": `// @flow\nconst m = match (a) {\n  1 => 2,\n  {b: const c} => c,\n  _ => 3,\n};\nmatch (a) {\n  1 | 2 => {\n    aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa(bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, cccccccccccccc);\n  }\n}\nconst r = R { a: 1 };\nconst s = new S();\n`,
    // A block comment before it on its line: the line does not start at the indentation.
    "comment-before-statement.ts": `describe("a", () => {\n  it("b", () => {\n    /* a\n b */ cccccccccccccccccccc(ddddddddddd!, "eeeeeeeeeeeeeeee", "fffffffffff");\n    /* g */ hhhhhhhhhhhhhhhhhhhhhhhh(iiiiiiiiiiiiiiiiiiiiiii, jjjjjjjjjjjjjjjjjjjjj);\n  });\n});\n`,
    // Text that has more bytes than columns, or escapes.
    // 80 and 81 columns.
    "wide-characters.js": `console.log(chalk.yellow("😈${"a".repeat(48)}"));\nconsole.log(chalk.yellow("😈${"a".repeat(49)}"));\nconst 名前 = { placeholder: "日付を選択してください", ключ: 'значение "x"', é: \`ü\${名前}ü\` };\nf("${"中".repeat(35)}", 12);\nf("${"中".repeat(35)}", 123);\nif (a) {\n  b = { c: "${"é".repeat(64)}" };\n  b = { c: "${"é".repeat(65)}" };\n}\n`,
    "escapes.js": `a = 'b\\'c' + "d\\"e" + 'f"g\\'' + "\\d\\u0041\\x41\\n" + /[\\\\/]\\d+/g.test(\`\\\${h}\\n\`);\nconst \\u0061b = c.\\u0064;\nimport "i\\x6a";\nx = "k\\\nl";\n`,
    "odd-white-space.js": `f(a,\n \nb);\ng(a,  b);\nh({ a: 1 });\ni("\u007fé", "\u007f", "\t");\n`,
    // `\\r\\n`
    "crlf.js": `import { a, b } from "c";\r\nf(a,\r\n\r\n  b);\r\nconst d = {\r\n  e: 1,\r\n  f() {\r\n    return g(h); /* i */\r\n  },\r\n};\r\nj(\`k\r\nl\`);\r\n`,
    "lone-cr.js": `f(a,\r\r  b);\nconst d = {\r  e: 1 };\n`,
    // Whether something follows on the line depends on the options.
    // 80 columns, and a comma or not.
    "last-property.js": `a = {\n  b: ${"c".repeat(21)}(${"d".repeat(25)}, ${"e".repeat(25)}),\n  f: ${"c".repeat(21)}(${"d".repeat(25)}, ${"e".repeat(25)})\n};\n`,
    // 80 columns, and a semicolon or not.
    "class-members.ts": `class A {\n  b = ${"c".repeat(20)}(${"d".repeat(25)}, ${"e".repeat(25)});\n  f = ${"c".repeat(20)}(${"d".repeat(25)}, ${"e".repeat(25)});\n  ["g"] = 1;\n  static;\n  h;\n  *i() {}\n  ${"j".repeat(26)}(${"k".repeat(23)}: L, ${"m".repeat(16)}: N) {}\n}\n`,
    // Without semicolons, some statements start with one.
    "start-of-statement.js": `a();\n[b].c();\n(d || e).f();\n\`g\`.h();\n+i;\n/j/.k();\n/** @type {A} */ (l).m();\n(() => {})();\nn => o;\nlet p = 1;\nclass Q {}\n`,
    // What the parser reads and the printer drops.
    "rest-parameter.ts": `declare function a(b, ...c?);\nfunction d(...e?: any[]) {}\n`,
    // JSX: on one line, or the tags, the attributes and the children on lines of their own.
    "elements.tsx": `const a = <B c="d" e={f} {...g} h />;\nconst i = <J k='l"m' n="o'p" q="&quot;">text  more\n  words</J>;\nrender(<R s={t}>{u}</R>);\nfunction V() {\n  return <div className="w" onClick={() => { x(); }} style={{ y: 1,\n z: 2 }}>\n    <A />\n\n    <B c="d">text</B>\n    {e}\n    {f.map(g => <li key={g}>{g}</li>)}\n    {h && <I j="k" />}\n    {l ? <M /> : <N />}\n    text <b>bold</b> and {more} text that goes on for some time so that it has to be wrapped\n    <></>\n    <O.P q:r="s" t-u="v" />\n  </div>;\n}\nconst w = () => <X y="z"><A /></X>;\nconst b = { c: <D><E /></D>, f: <G /> };\n`,
    "elements-wide.jsx": `function A() {\n  return (\n    <${"B".repeat(30)} ${"c".repeat(20)}="d" ${"e".repeat(19)}="f" />\n  );\n}\nfunction G() {\n  return (\n    <${"B".repeat(30)} ${"c".repeat(20)}="d" ${"e".repeat(20)}="f" />\n  );\n}\nfunction H() {\n  return <I j="${"k".repeat(80)}">{l}</I>;\n}\nfunction M() {\n  return <N>${"o".repeat(66)}</N>;\n}\nfunction P() {\n  return <N>${"o".repeat(67)}</N>;\n}\nfunction Q() {\n  return <N>${"é".repeat(66)}</N>;\n}\n`,
    "elements-odd.jsx": `a = <>{await (<B>\n  c d e f\n</B// g\n>)}</>;\nh = <div>{i ? (j ? <K /> : <L />) : null}</div>;\nm = <div>\n  First <div>\n    Second\n  </div> Third\n</div>;\nn = <style jsx>{\`\n  div { color: red }\n\`}</style>;\no = <P css={\`color: red\`} q={\`r\${s}\`} />;\nt = <U>{/* v */}</U>;\nw = <X>{" "}y{" "}</X>;\nz = <A b=<C /> />;\n`,
    "only-element.md": "```jsx\n<A b={{ c: 1 }}>...</A>\n```\n\n```jsx\n<A />;\n<B />\n```\n",
    "elements-in-parentheses.jsx": `a = b[<c />];\nclass D {\n  e = <f />;\n}\ng = [...<h />];\n`,
    // A name is printed without escapes, however it gets to the line.
    "escaped-names.ts": `class A {\n  \\u0061b: C;\n  d\\u0065() {}\n}\ninterface F {\n  \\u0067: H;\n}\nconst i = { \\u006a: 1,\n  k: 2 };\n`,
    // 80 columns, and a semicolon or not.
    "union-width.ts": `type ${"A".repeat(30)} = "${"b".repeat(35)}" | "${"c".repeat(36)}";\ninterface D {\n  ${"e".repeat(30)}: "${"b".repeat(35)}" | "${"c".repeat(34)}";\n}\n`,
    "ignored-mapped-type.ts": `type A= {\n    /* prettier-ignore */\n    [B in C]: D  |  E\n  }\n`,
    "flow-other-kinds.js": `// @flow\ninterface A { b: C }\nenum D of string { E = "e" }\nswitch (f) {\n  case 1:\n    g();\n}\ndeclare class H { i(): void; [k: string]: J }\nfor (let l = 0; l < 1; l++) m();\n`,
    // However deep in the head of a loop, `a in b` is in parentheses.
    "in-operator.js": `for (var a = {\nb: (b in c)};;);\nfor (a = () => { d = { e: (b in c),\n f: 1 }; g(h in i); };;) {\n  x();\n}\n`,
    // Scripts in other languages.
    "component.vue": `<script setup lang="ts">\nimport { ref } from 'vue'\nconst aaaaaaaaaaaaaaaaaaaaaaaaa = bbbbbbbbbbbbbbbbbbbbbbbbbbb(ccccccccccccccccccc, dddddd)\nfunction e() {\n  return f(() => {\n    g('h')\n  })\n}\n</script>\n<template>\n  <div @click="e()">{{ a }}</div>\n</template>\n`,
    "page.html": `<html>\n<body>\n<div><div><script>\nconst aaaaaaaaaaaaaaaaaaaaaaa = bbbbbbbbbbbbbbbbbbbbbbb(ccccccccccccccccc, dddddd)\nfunction e() { return f(() => { g('h') }) }\n</script></div></div>\n</body>\n</html>\n`,
    "text.md":
      "- a\n\n  ```js\n  const aaaaaaaaaaaaaaaaaaaaaaaaaaa = bbbbbbbbbbbbbbbbbbbbbbbbbbbb(ccccccccccccccccccc, dddd)\n  function e() { return `f\n  g` }\n  ```\n\n```jsx\n<a b='c' />\n```\n",
    "text.mdx":
      "import   {a} from 'b'\nexport const c = { d: 1,\n e: f(g) }\n\n# h\n\n<A b={() => { c('d') }} />\n\n```ts\nlet i: J = k('l')\n```\n",
  };

  test.concurrent.each([
    [[]],
    [["--print-width=24"]],
    [["--print-width=60", "--use-tabs"]],
    [["--tab-width=8", "--single-quote", "--no-bracket-spacing"]],
    [["--no-semi"]],
    [["--quote-props=consistent"]],
    [["--no-semi", "--trailing-comma=none", "--end-of-line=crlf"]],
    [["--trailing-comma=none", "--vue-indent-script-and-style"]],
    [["--bracket-same-line", "--jsx-single-quote", "--print-width=40"]],
    [["--single-attribute-per-line", "--print-width=27"]],
  ])("the same with %j", async flags => {
    flags = ["--no-config", ...flags];
    const [short, long] = await Promise.all([format(files, flags), format(files, [...flags, "--no-short-cuts"])]);
    expect(short).toEqual(long);
    expect(long.stderr).toBe("");
    expect(long.texts).not.toEqual(files);
    expect(long.exitCode).toBe(0);
  });

  const flagsForOxfmt = [[[]], [["--print-width=40"]], [["--print-width=6"]], [["--no-semi"]]];
  test.concurrent.each(flagsForOxfmt)("the same as oxfmt with %j", async flags => {
    const all = {
      ...files,
      ".oxfmtrc.json": "{}\n",
      // oxfmt has no line for all of a union, and counts the line breaks between two arguments.
      "union.ts": `type ${"A".repeat(40)} = "${"b".repeat(20)}" | "${"c".repeat(20)}";\n`,
      // For oxfmt the value of a native event handler in Vue is a script, whose quotes are written as entities.
      "handlers.vue": `<template>\\n  <div onclick="${"a".repeat(50)}('b'); c()" onfocus="d('e')"></div>\\n</template>\\n`,
      "loop-body.js": `for (x in y) var a = 1, b = 2;\\nwhile (x) var e = 1, f = 2;\\n`,
      "intrinsic.ts": `type A = (intrinsic);\\ntype B = (intrinsic) | C;\\n`,
      "comma-on-its-line.js": `a(\n  "b"\n,\n  async () => {}\n);\n`,
      "parenthesis-on-its-line.js": `a(o,\n(\n[{"":l}]))\n`,
      "empty-line-in-chain.js": `e=a.\n\ne(wo)\n`,
      "types-in-javascript.js": `type A = { b: C; d: E };\ndeclare export { f };\n`,
    };
    const [short, long] = await Promise.all([format(all, flags), format(all, [...flags, "--no-short-cuts"])]);
    expect(short).toEqual(long);
    expect(long.texts).not.toEqual(all);
  });
});

/** Formats `files` in place, and returns what they are afterwards. */
async function formatInPlace(files: Record<string, string>, flags: string[]) {
  using dir = tempDir("format-short-cuts", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "fmt", "--no-editorconfig", "--log-level=silent", ...flags, "."],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  const formatted = Object.fromEntries(
    Object.keys(files).map(name => [name, readFileSync(join(String(dir), name), "utf8")]),
  );
  return { formatted, stderr, exitCode };
}

/** `inputs` once for each set of options, each time in a directory with a `.prettierrc`. */
function inDirectoriesWithOptions(inputs: Record<string, string>, options: object[]) {
  const files: Record<string, string> = {};
  options.forEach((set, index) => {
    files[`${index}/.prettierrc`] = JSON.stringify(set);
    for (const [name, text] of Object.entries(inputs)) files[`${index}/${name}`] = text;
  });
  return files;
}

describe.skipIf(!hasFlag)("expressions that are too wide for their line", () => {
  // Each of these was printed differently with and without short cuts at some width.
  const inputs = {
    // Without a comma after it, the last property fits.
    "last-property.ts": `const messages = {\n  pagination: {\n    deprecationWarning: "Deprecated usages detected, please refer to the documentation for more",\n  },\n};\n`,
    // The first place where the right side can break is the \`(\`.
    "optional-call.ts": `function f() {\n  const selectedOption = this.autocomplete.options?.find((option) => option.selected);\n  const dragRange = this._rangeStrategy.createDrag?.(this.activeDrag.value, this.selected as DateRange<D>, value, event);\n}\n`,
    // An assignment on a line of its own among the arguments keeps its parentheses.
    "assignment-argument.ts": `register(someLongFunctionName, anotherLongArgument, (scope.onConnectionClosed = onConnectionClosed.bind(scope)));\n`,
    // What can't be written isn't too wide.
    "arrow-argument.ts": `const testResults = results.testResults.map((testResult) => formatResult(testResult, formatter, reporter));\nconst options = {\n  options: optionDebugEls.map((el) => el.injector.get<CdkOption<O>>(CdkOption)),\n};\n`,
    // A comment forces a line break that isn't seen before the line is full.
    "dangling-comment.js": `func(one, two, three, four, five, six, seven, eig, is, this, too, long, yes, {\n  // Comments\n});\nvar a = {/* dangling */};\n`,
    // A chain is on one line if it fits up to a line break that's forced in its last call.
    "chain-with-method.js": `jest.dontMock("event-target-shim").setMock("../../BatchedBridge/NativeModules", { Networking: { sendRequest(options, callback) { if (typeof callback === "function") { callback(1); } } }, PlatformConstants: { getConstants() {} } });\n`,
    // Nothing fits after a string that's too wide.
    "long-strings.ts": `it("should return true for an element with \`visibility: hidden\` ancestor and *closer* " + "\`visibility: visible\` ancestor", () => {\n  run();\n});\nthrow new Error("deleteSelectedTextAndJoinRemainingNodes(): cannot delete because of must-keep division: " + division.properties.name);\n`,
    // The right side moves to the next line if it doesn't fit up to where it can break first.
    "conditional.ts": `function f() {\n  const bytes: NodeJS.TypedArray = require("node:util/types").isAnyArrayBuffer(serialized) ? new Uint8Array(serialized as ArrayBufferLike) : serialized;\n  const limit = start ? 0 : this.maximumNumberOfConnections;\n  const hideEvent = active ? EventHandler.trigger(active, EVENT_HIDE, { relatedTarget: innerElem }) : null;\n}\n`,
    // The object that an arrow function returns brings its parentheses.
    "arrow-body.ts": `export const setProp = (y) => ({\n  ...y,\n  a: "very, very, very long very, very long text",\n});\nconst isNeedInserted = () => React.Children.count(children) === 1 && !icon && !isUnBorderedButtonType(type);\nconst settingOpen = (value: boolean, e?: React.MouseEvent<HTMLButtonElement> | React.KeyboardEvent<HTMLDivElement>) => {\n  setOpen(value, true);\n};\nconst Alert = ({ description, prefixCls, message, banner, className, style, onMouseEnter, onMouseLeave }) => {\n  run();\n};\n`,
    // There's no line break between the arguments of a test.
    "tests.ts": `beforeEach(inject([FocusMonitor], (fm: FocusMonitor) => {\n  focusMonitor = fm;\n}));\nit("should close all open dialogs when the location hash changes", fakeAsync(() => {\n  flush();\n}));\nbeforeEach(waitForAsync(() => {\n  TestBed.configureTestingModule({ imports: [OverlayTestModule] });\n}));\n`,
    // The cells of a table are printed apart from the file, on one line.
    "table.js": `test.each\`\na | b\n\${[{ start: 1, end: 3 }, { start: 15, end: 20 }, { start: 15, end: 20 }]} | \${1}\n\`("example test", ({ a, b }) => {});\n`,
    // The parentheses of an \`await\` at the start of the argument of an \`await\` have no group of their own.
    "await.ts": `async function f() {\n  await (await (await a.b.c(d))?.e())?.f;\n  const x = await (await a).b;\n  await (await a)();\n}\n`,
    // The parameters of a function expression can break while it's hugged, so a chain fits up to its \`(\`.
    "chain-with-function.ts": `const mockFn = vi.fn().mockImplementation(function (this: MockWithPrettyLongName) {\n  return this;\n});\njest.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element, ...args) {\n  return args;\n});\n`,
    // Neither the \`?\` nor the default of a rest parameter is printed.
    "rest-parameters.ts": `const a = (...a?: T) => {};\nconst b = (...a = 1) => {};\nconst c = (...a?: T[]) => {\n  run();\n};\nclass F {\n  g(...a?: T) {}\n}\nconst i = (a?, ...b?) => a;\nconst j = function (this: T, ...b?: U[]) {};\nconst l = (this: T) => {};\nconst o = (...{ a }?: T) => {};\nconst p = (...[a] = []) => {};\ntype Q = (...a?: T) => void;\ndeclare function s(...a?: T): void;\n`,
    // Functions among the arguments of a decorator don't put each on a line, and the line can break after a decorator.
    "decorators.ts": `class A {\n  @ContentChildren(forwardRef(() => MatRadioButton), { descendants: true })\n  _radios: QueryList<MatRadioButton>;\n  @OneToMany((type) => Topic, (topic) => topic.board)\n  topics: Topic[];\n  @Input({ transform: booleanAttribute }) showBeforeIframeApiLoads: boolean = false;\n}\n`,
    "computed-key.ts": `class A {\n  [thisxxxxxxxxxxxx.resource = resource] = 1;\n  [this.resource = resource]() {}\n}\n`,
    // An empty line between two properties stays, so the object breaks, and the chain fits up to its brace.
    "empty-line.ts": `jest.unmock("event-target-shim").setMock("../../BatchedBridge/NativeModules", {\n  BlobModule: require("../__mocks__/BlobModule"),\n\n  FileReaderModule: require("../__mocks__/FileReaderModule"),\n});\n`,
    // Whether a \`;\` follows a property of a class without semicolons depends on the next member.
    "class-properties.ts": `class A {\n  readonly hasFocus: Observable<boolean> = this._hasFocus.pipe(startWith(false), debounceTime(0), distinctUntilChanged());\n  scrolledIndexChange: Observable<number> = this._scrolledIndexChange.pipe(distinctUntilChanged());\n  [key] = 1;\n}\n`,
    // The \`}\` in JSX is on a line of its own after the body of an arrow function that is.
    "jsx-arrow.tsx": `const a = (\n  <Switch\n    onValueChange={(enabled) => setProps((prev) => ({ ...prev, transparent: enabled }))}\n    value={value}\n  />\n);\n`,
    "in.ts": `for (var a = {\n  b: b in c };;);\nfor (var a = f(b in c);;);\n`,
    "calls.ts": `expect(keyManager.getActiveItemIndex()).withContext("active item index").toBe(0);\nexpect(fixture.componentInstance.connectedOverlayDirective.push).not.toBe(true);\nconst lineAndCharacter = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile), true);\nthis._requestAnimationFrame(() => this._hostElement.classList.add(OPENING_CLASS, OPEN_CLASS));\nsetTimeout(() => {\n  done();\n}, 1000);\nuseEffect(() => {\n  subscribe();\n}, [subscribe, unsubscribe]);\nexpect(() => {\n  fixture.detectChanges();\n}).not.toThrow();\nrerender(createTable({\n  columns,\n  dataSource,\n}));\nconst { getPrefixCls, direction, pagination = {} } = React.useContext(ConfigContext);\nconst { fixture, testComponent, listbox, listboxEl, options, optionEls } = setupComponent(ListboxWithOptions);\n`,
    "conditions.ts": `if (!this._hasAllOutlets && this._rowOutlet && this._headerRowOutlet && this._footerRowOutlet) {\n  run();\n} else if (value !== "above" && value !== "below" && (typeof ngDevMode === "undefined" || ngDevMode)) {\n  stop();\n}\nfunction f() {\n  return this._disabled || (this.buttonToggleGroup && this.buttonToggleGroup.disabled) || other;\n}\nconst deferredBody = body !== undefined && (isBlob(body) || FileHandle.isFileHandle(body));\nconst preview = document.querySelector(".cdk-drag-preview-with-a-long-name")! as HTMLElement;\nconst trigger = fixture.debugElement.query(By.css(".mat-mdc-select-trigger"))!.nativeElement;\n`,
    "literals.ts": `const routes = [{ path: "a", component: A }, { path: "b", component: B }];\nconst table = { "quoted-key": 1, 2: two, [computed]: three, plain: [first, second, { third: function () { return 3; } }] };\n`,
  };
  const widths = [
    20, 24, 30, 34, 36, 40, 45, 50, 60, 66, 70, 72, 74, 76, 78, 79, 80, 81, 82, 84, 88, 90, 100, 110, 120,
  ];
  const others = [
    {},
    { trailingComma: "none" },
    { objectWrap: "collapse", tabWidth: 4 },
    { useTabs: true, arrowParens: "avoid", bracketSpacing: false },
    { quoteProps: "consistent", singleQuote: true },
    { semi: false },
  ];
  const files = inDirectoriesWithOptions(
    inputs,
    others.flatMap(set => widths.map(printWidth => ({ printWidth, ...set }))),
  );

  test("are the same with and without short cuts", async () => {
    const [short, long] = await Promise.all([formatInPlace(files, []), formatInPlace(files, ["--no-short-cuts"])]);
    expect(short).toEqual(long);
    expect(short.stderr).toBe("");
    expect(short.exitCode).toBe(0);
  });
});

describe("Handlebars", () => {
  const texts = [
    // The common shapes.
    '<div class="a">\n  <p>Some text {{this.name}}</p>\n  {{#if this.b}}\n    <Foo @a={{this.c}} @d="e" />\n  {{else}}\n    {{yield (hash f=this.g)}}\n  {{/if}}\n</div>',
    "<div   class='a'  id=b >\n<p>Some   text\n{{ this.name }}</p>\n\n\n\n{{#if  this.b}}<Foo  @a={{ this.c }}></Foo>{{else}}x{{/if}}</div>\n",
    "a {{b}} c",
    "a {{b}} c\n{{d}}",
    "\n\n  a",
    " a ",
    "  <b>a</b>  \n\n",
    "<div>a {{b}} c</div>\n<p> x </p>\n<p>\nx</p>\n<p>x\n</p>\n<p>\n\n\nx\n\n\n</p>",
    "<div></div><div> </div><div>\n</div><div>\n\n</div>",
    "<Foo></Foo><Foo> </Foo><Foo>\n</Foo><f.x>\n</f.x><:x>\n</:x><@x> </@x><this.x></this.x>",
    "<br><br/><br /><img src='a'><input disabled>\n<hr\n>",
    "<Textarea /><Pre /><Title></Title><Script />\n<pre>\n a\n</pre>\n<textarea>\n a\n</textarea>\n<script>\n a < b\n</script>\n<style>\n a { b: c }\n</style>\n<title> a </title>\n<script />\n<b>c</b>",
    "some words that go on and on and on and on and on and on and on and on and on and on and on and on\nand on <b>and on</b> and on and on",
    "<p>some words that go on and on and on and on and on and on and on and on and on and on and on and on</p>",
    "<p>a<b>c</b>\nd</p>\n<p>a <b>c</b>\nd</p>\n<p>a <b>c</b> d</p>",
    "<ul><li>a</li><li>b</li></ul>\n<ul><li>a</li> <li>b</li></ul>\n<ul><li>a</li>\n<li>b</li></ul>",
    // Mustaches.
    "{{a}}{{a.b}}{{@a.b}}{{this}}{{this.a}}{{a-b}}{{{a}}}{{~a~}}{{~{a}~}}{{ a }}{{\na\n}}",
    '{{a b}}\n{{a "b" \'c\' 1 true null undefined d=e f="g" h=(i j)}}\n{{a\n  b\n}}\n{{a (b)}}\n{{a (b (c (d e)))}}',
    "{{someHelper someArgument anotherArgument yetAnotherArgument andOneMoreArgument key=value other=another}}",
    "{{someHelper (someOtherHelper someArgument anotherArgument yetAnotherArgument andOneMoreArgument) key=(a b)}}",
    "{{someHelper key=(someOtherHelper someArgument anotherArgument yetAnotherArgument andOneMore key=(a b))}}",
    '{{true}}{{false}}{{null}}{{undefined}}{{1}}{{"a"}}{{\'a\'}}{{"...attributes"}}\n{{true a}}\n{{1 a}}',
    '{{a "it\'s"}}{{a \'say "b"\'}}{{a "\\""}}{{a "b\\\\"}}{{a "{{"}}{{a "}}"}}{{a "é"}}{{a "\n"}}',
    "{{a 0}}{{a 00}}{{a 1.5}}{{a -1}}{{a 123456789012345}}{{a 1234567890123456}}",
    "{{a -0}}{{a -00}}{{a 0.0}}{{a -0.5}}{{a 1.50}}{{a 10.25}}{{a 0.000001}}{{a 0.0000001}}{{-1}}{{0.5}}{{a b=-1.5}}",
    "{{a 123456789.123456}}{{a 1234567890.123456}}{{a 0.12345678901234}}{{a 0.123456789012345}}",
    "{{a 1.}}",
    "{{a .5}}",
    "{{a 1.5.2}}",
    "{{a 1-2}}",
    "{{a -}}",
    "{{a.true}}\n{{true.a}}\n{{a.this}}\n{{@this}}\n{{a.else}}\n{{elsewhere}}\n{{a/b}}\n{{../a}}\n{{a.[b]}}\n{{[a]}}\n{{a.1}}\n{{a.#b}}\n{{é}}",
    "{{a b = c}}\n{{a b= c}}\n{{a b=c d}}\n{{a as |b|}}\n{{a (b as |c|)}}\n{{(a) b}}\n{{(a).b}}\n{{a (b).c}}",
    "{{&a}}\n{{>a}}\n{{*a}}\n{{^}}\n{{a}}}\n{{{a}}\n{{{{a}}}} {{{{/a}}}}",
    // Blocks.
    "{{#if a}}{{/if}}{{#if a}} {{/if}}{{#if a}}\n{{/if}}{{#if a}}b{{/if}}{{#if a}} b {{/if}}{{#if a}}\nb\n{{/if}}",
    "{{#if a}}b{{else}}c{{/if}}\n{{#if a}}b{{else}}{{/if}}\n{{#if a}}b{{else}} {{/if}}\n{{#if a}}b{{else}}\n{{/if}}\n{{#if a}} {{else}} {{/if}}",
    "{{#if a}}\n  b\n{{else if c}}\n  d\n{{else if e}}\n{{else}}\n  f\n{{/if}}",
    "{{#a b}}c{{else a d}}e{{/a}}\n{{#a b}}c{{else f d}}e{{/a}}\n{{#a b}}c{{else if d}}e{{else a f}}g{{/a}}\n{{#a.b c}}d{{else a.b e}}f{{/a.b}}",
    '{{#this}}{{else this "" q}}{{/this}}',
    "{{#if a}}b{{else}}{{#if c}}d{{/if}}{{/if}}\n{{#if a}}b{{else}} {{#if c}}d{{/if}}{{/if}}\n{{#if a}}b{{else if}}c{{/if}}\n{{#if a}}b{{else if as |c|}}d{{/if}}",
    "{{~#if a~}}b{{~else~}}c{{~/if~}}\n{{~#if a~}} b {{~else if c~}} d {{~/if~}}",
    '{{#each a as |b c|}}d{{/each}}\n{{#each a key="b" as | c |}}d{{/each}}\n{{#a as |b|}}c{{/a}}\n{{#a}}b{{/a}}\n{{# a }}b{{/ a }}',
    "{{#let (hash someKey=this.some.long.path.toSomething anotherKey=this.another.long.path) as |value|}}\n  {{value}}\n{{/let}}",
    "{{#someBlock someArgument anotherArgument yetAnotherArgument andOneMoreArgument andYetAnotherOne key=value as |a|}}b{{/someBlock}}",
    "{{#a as |true|}}{{/a}}",
    "{{#a as |undefined |}}{{/a}}",
    "{{#a as |as\n|}}{{/a}}",
    "{{#a as |this|}}{{/a}}",
    "<a as |true|></a>\n<a as |as |></a>",
    "{{#if a}}b{{/unless}}",
    "{{#if a}}<b>{{/if}}</b>",
    "<b>{{#if a}}</b>{{/if}}",
    '{{^a}}b{{/a}}\n{{#a}}b{{^}}c{{/a}}\n{{#>a}}b{{/a}}\n{{#*inline "a"}}b{{/inline}}',
    // Attributes.
    '<a b c="d" e=\'f\' g=h i={{j}} k="{{l}}" m="n {{o}} p" ...attributes {{on "q" r}} {{! s }} as |t u|>v</a>',
    '<SomeComponent @someArgument={{this.someValue}} @anotherArgument="another value" class="some classes" as |value|>a</SomeComponent>',
    "<SomeComponent @someArgument={{someHelper this.someValue this.anotherValue this.yetAnotherValue key=this.value}} />",
    "<a\n  b\n>c</a>\n<a\n  b\n/>\n<a\n>c</a>\n<a b\n  c>d</a>",
    '<a class=""><a class=" "><a class=" b  c "><a class="b\n  c"><a class=\'b\'><a CLASS=" b "><a class=b></a></a></a></a></a></a></a>',
    '<a class="b {{c}}"><a class="{{c}} b"><a class="{{c}} "><a class=" {{c}}"><a class="{{c}}{{d}} {{e}}"><a class="b{{c}}d"></a></a></a></a></a></a>',
    "<div class=\"some-class another-class yet-another-class {{if this.condition 'one-more-class'}} and-a-last-one\">a</div>",
    "<div class=\"some-class another-class yet-another-class and-one-more-class\n  {{if this.condition 'one-more-class'}}\">a</div>",
    "<div\n  class=\"some-class another-class yet-another-class and-one-more-class-here\n    {{if this.condition 'one-more-class'}}\"\n>a</div>",
    "<b class=\"{{if this.someCondition (concat 'some-class-' this.someSuffix) (concat 'another-class-' this.anotherSuffix)}}\">a</b>",
    '<a title="it\'s"><a title=\'say "b"\'><a title=\'c\'><a title="&quot;"><a title="é"><a title="a\nb"><a title="a\\"></a></a></a></a></a></a></a>',
    '<a title=\'"" {{b}}\'><a title="\'\' {{b}}"><a title="{{b "c"}}"><a title=\'{{b "c"}}\'><a title="{{b \'c\' d="e"}}"></a></a></a></a></a>',
    '<a href="some-very-long-address-that-does-not-fit-on-the-line-at-all/{{this.id}}/and-goes-on-and-on-behind-it">b</a>',
    '<a href="some-very-long-address-that-does-not-fit-on-the-line-at-all/{{if a b}}/and-goes-on-and-on-behind-it">b</a>',
    '<a b = "c"></a>\n<a b= "c"></a>\n<a b="c"d="e"></a>\n<a b=c/>\n<a b=/c></a>\n<a b={{c}}d></a>\n<a b={{c}}/>\n<a {{b}}c></a>',
    "<a {{true}}></a>",
    "<a {{~b}}></a>\n<a {{b~}}></a>\n<a {{{b}}}></a>\n<a {{! prettier-ignore }} b = c></a>\n<a {{#if b}}c{{/if}}></a>",
    '<a as></a>\n<a as b></a>\n<a aspect="b"></a>\n<a as |b| c></a>\n<a as|b|></a>\n<a |b|></a>',
    "<iMg>\n<dIv></dIv>\n<BR>\n<a$b></a$b>\n<a.></a.>\n<x-></x->",
    "</a>",
    "<a></a >\n<a></a\n>\n<Foo></Foo >",
    // A component is known to be empty before the white space in it counts as a line break.
    " }<Foo::Bar>\n</Foo::Bar\n>",
    ' (<Foo::Bar k="" as |f|>\n</Foo::Bar\n>',
    // A start tag or the head of a block that isn't certain goes the long way without what is in the element or block.
    '<div title="a\nb">\n  <p   c>d</p>\n  {{e   f}}\n</div>',
    "{{#if (eq a.[b] 1)}}\n  <p   c>d</p>\n{{else}}\n  {{e   f}}\n{{/if}}",
    '<div>\n  x<div title="a\nb" class="some classes that take some room on the line" id="and-some-more-of-it">\n    <p   c>d</p>\n  </div>\n</div>',
    '<div title="a\nb"> <p   c>d</p>\n</div>\n<div title="a\nb"><p   c>d</p>\n</div>\n<div title="a\nb">\n</div>',
    '<Foo title="a\nb">\n</Foo>\n<Foo title="a\nb">\n\n  c\n</Foo>\n<img title="a\nb">\n<Foo title="a\nb" />\n',
    "{{#if a.[b]}}\n{{/if}}\n{{#if a.[b]}}\n{{else}}\n  c\n{{/if}}\n{{#if a.[b]}} c\n{{/if}}\n{{#a.[b] c}}\n  d\n{{/a.[b]}}",
    '<div title="a\\">\n  <p   c>d</p>\n</div>\n<div title="\\{{a}}">\n  <p   c>d</p>\n  \\\\{{e}}\n</div>',
    '<div title="a\nb>\n  <p   c>d</p>\n</div>',
    '<pre title="a\nb">\n  c\n</pre>\n<div title="a\nb">\n\f  c\n</div>',
    "{{#if a}}\n  b\n{{else if c.[d]}}\n  e\n{{/if}}",
    // What is too wide as far as it's read can be narrower as it's written, which is how it's printed.
    "x <i a=b a=b a=b a=b a=b \\{{></i>",
    "<p>x <i a=b a=b a=b a=b a=b \\{{></i></p>",
    // Comments.
    "{{! a }}{{!a}}{{!}}{{! }}{{~! a ~}}{{!-- a --}}{{!-- a }} --}}{{!----}}{{!--}}{{!---}}{{!- a -}}{{! a --}}{{!-- a ~--}}{{! a~ }}",
    "{{! a\n   b }}c\n<b>{{! a\n   b }}</b>\n{{!-- a\n   b --}} {{c d}}",
    "<!-- a --><!--a--><!----><!--><!---><!-- a -- b --><!-- a ---><!-- {{a}} --><!-- \\{{a}} --><!-- é -->",
    "<!-- a\n     b -->c\n<b><!-- a\n b --></b>",
    "<!-->-->\nf",
    "{{#a}}\n<!-->--> x{{/a}}",
    "<!DOCTYPE html>\n<a>b</a>",
    // `prettier-ignore` is about the next node but one.
    "{{! prettier-ignore }}\n<a   b>c</a>\n<a   b>c</a>",
    "{{! prettier-ignore }}<a   b>c</a>\n<a   b>c</a>\n<a   b>c</a>",
    "{{! prettier-ignore }}{{  a}}\n\n{{! prettier-ignore }}\n   b\n\n{{! prettier-ignore }}     c\n\n{{  d}}",
    "{{! prettier-ignore }}{{  a}}\n\n\n",
    "x\n{{! prettier-ignore }}{{  a}}\n\n\n",
    "x\n{{! prettier-ignore }}{{  a}}b  \n\n\n",
    "x\n{{! prettier-ignore }}\n\n\n",
    "{{! prettier-ignore }}{{  a}}   b   \n\n\n{{  c}}",
    "<a>\n  {{! prettier-ignore }}\n  <b   c>d</b>\n</a>\n<a>{{! prettier-ignore }}</a>\n<a>\n{{! prettier-ignore }}\n</a>\n<a>\n{{! prettier-ignore }} <b   c></b></a>",
    "{{!-- prettier-ignore --}}\n{{  a}}\n{{!prettier-ignore}}\n{{  a}}\n{{  a}}",
    "{{! prettier-ignore }}",
    "a\n{{! prettier-ignore }}\n",
    // Backslashes. After an escaped mustache, those in front of the next one are a text of their own.
    "\\{{a}}\n\\\\{{a}}\n\\\\\\{{a}}\na\\\n<b>\\</b>\n<b>a\\{{c}}</b>\na \\ b",
    "\n\\{{",
    "\n\\ a",
    "<a ></a>\n\\{{<br> :\n\\\\{{o}}<b></b>",
    '<a b="c \\{{"> \\{{ </a>\n<a class=" d \\{{">\\{{</a>\n\n<e>f</e>\n{{g}}',
    "a \\{{b}} c\n{{d}}\n\\{{e}}\nf\n\\{{g}}",
    // A string ends at a quote with a backslash in front of it only if there's no other one, however far away.
    "<script>{{'\\'\"\\\"}}</script>\n'",
    "<pre>{{a '\\'}}</pre>\n{{b}}\n'",
    "<pre>{{a.[b\\]}}</pre>\n{{c}}\n]",
    // White space that isn't a blank, a tab or a line feed.
    "\n\fa",
    "{{a}}\n\fb",
    "a\n\f\n{{b}}",
    "<a>\n<b></b>c\n\f\n{{d}}</a>",
    "<a><b>\nc\n</b> \f </a>",
    "a\rb\n{{c}}\r{{d}}",
    "<Foo>\f</Foo>\n{{#a}}\f{{/a}}",
    "a\u00a0b \u00a0 c\n{{d}}\u00a0{{e}}",
    "a\tb\n\t{{c}}\t{{d}}\n<e\tf\t>\tg\t</e>",
    // Widths.
    "日本語の文章 日本語の文章 日本語の文章 日本語の文章 日本語の文章 日本語の文章 日本語の文章 日本語の文章",
    "<p>e\u0301e\u0301e\u0301 👍👍👍 {{a}} é</p>",
    '<a title="日本語の文章" class="日本語 の文章" data-b=\'é\' {{c "日本語の文章" d="é"}}>{{e "日本語の文章 日本語の文章" f=\'é\'}}</a>',
    '<a title="e\u0301e\u0301e\u0301e\u0301e\u0301e\u0301e\u0301e\u0301" b="c">{{d "👍👍👍👍👍👍👍👍👍👍" "it\u2019s" "a\u00a0b" "\u2028"}}</a>',
    '<a title="a\u007fb">{{c "d\u007fe"}}</a>\n<a title="a\u0001b"></a>\n<a title="a\tb"></a>',
    "a\u0001b\n{{c}}",
    "a\u0000b",
    // What loses text is printed as it is.
    "a < b\n{{  c}}",
    "<a>\n  b <\n{{  c}}</a>",
    "<a b",
    "{{a",
    "{{#a}}",
    "<a>",
    "",
    "\n",
    "---\na: b\n---\n{{  c}}",
  ];
  const options = [
    [],
    ["--print-width=40"],
    ["--print-width=33"],
    ["--print-width=20", "--single-quote"],
    ["--print-width=1"],
    ["--print-width=100000"],
    ["--tab-width=4"],
    ["--tab-width=0"],
    ["--tab-width=5000", "--print-width=20"],
    ["--tab-width=4294967295"],
    ["--use-tabs"],
    ["--use-tabs", "--tab-width=8", "--print-width=30"],
    ["--single-quote"],
    ["--end-of-line=crlf"],
    ["--end-of-line=cr"],
    ["--end-of-line=auto"],
    ["--html-whitespace-sensitivity=ignore"],
    ["--html-whitespace-sensitivity=strict"],
    ["--embedded-language-formatting=off"],
  ];
  expectSame("a.hbs", texts, options);

  describe("with other line endings and a byte order mark", () => {
    const others = texts
      .slice(0, 40)
      .flatMap(text => [text.replaceAll("\n", "\r\n"), text.replaceAll("\n", "\r"), `\uFEFF${text}`]);
    expectSame("a.hbs", others, [[], ["--end-of-line=auto"], ["--end-of-line=crlf", "--print-width=30"]]);
  });

  // Every construct next to every neighbor in every place, at widths around those at which something in them breaks.
  describe("in every place", () => {
    const constructs = [
      "word",
      "some more words",
      "{{a}}",
      "{{a b c=d}}",
      "{{a (b c d=e)}}",
      "<b>x</b>",
      "<b> x </b>",
      "<b>\nx\n</b>",
      '<b c="d" e={{f g}}>x</b>',
      '<b class="x {{y z}} w">v</b>',
      "<br>",
      "<Foo> </Foo>",
      "{{#if a}} {{/if}}",
      "{{#if a}}x{{else}}y{{/if}}",
      "{{#if a}}\nx\n{{else if b}}\ny\n{{/if}}",
      "{{#foo a b=c as |d e|}}x{{/foo}}",
      "{{! c }}",
      "<!-- a\n  b -->",
      "{{! prettier-ignore }}",
      "<pre>\n x\n</pre>",
      "\\{{a}}",
    ];
    const neighbors = ["", " ", "\n", "x", "{{n m}}", "<i>n</i> "];
    const places = [
      ["", ""],
      ["<div>", "</div>"],
      ["<div>\n", "\n</div>"],
      ["{{#if c}} ", " {{/if}}"],
      ["{{#if c}}\nq\n{{else}}\n", "\n{{/if}}"],
      ['<div class="k"><p>', "</p></div>tail"],
    ];
    const all = constructs.flatMap(construct =>
      neighbors.flatMap(before =>
        neighbors.flatMap(after => places.map(([open, close]) => `${open}${before}${construct}${after}${close}`)),
      ),
    );
    expectSame("a.hbs", isDebug ? all.filter((_, index) => index % 16 === 0) : all, [
      [],
      ["--print-width=30"],
      ["--print-width=16"],
      ["--print-width=8"],
    ]);
  });

  test.skipIf(!hasFlag)("what has been formatted", async () => {
    const dir = tempDir("format-short-cuts", Object.fromEntries(texts.map((text, index) => [`${index}.hbs`, text])));
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fmt", "--write", "--no-config", "--no-editorconfig", "--log-level=silent", "."],
      cwd: String(dir),
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;
    const formatted = texts.map((_, index) => readFileSync(join(String(dir), `${index}.hbs`), "utf8"));
    dir[Symbol.dispose]();
    const { different, said, expected } = await differences("a.hbs", formatted, []);
    expect(different).toEqual([]);
    expect(said).toEqual(expected);
  });

  test.skipIf(!hasFlag)("expressions in expressions take linear time", async () => {
    const nest = (open: string) => `{{a ${open.repeat(120)}c${")".repeat(120)}}}\n`;
    // 0.6 in a release build, and 3 when each one read all that are in it to find that they don't fit.
    const text = (nest("(b ") + nest("(b d=")).repeat(isDebug ? 20 : 400);
    expect(await cpuTimeOfShortCuts("a.hbs", text)).toBeLessThan(1.8);
  });

  test("a text that is formatted stays as it is", async () => {
    const formatted = [
      '<div class="a">\n  <p>Some text {{this.name}}</p>\n  {{#if this.b}}\n    <Foo @a={{this.c}} @d="e" />\n  {{else}}\n    {{yield (hash f=this.g)}}\n  {{/if}}\n\n  {{! h }}\n  <!-- i -->\n</div>',
      "<SomeComponent\n  @someArgument={{this.someValue}}\n  @anotherArgument={{someHelper\n    this.someValue\n    this.anotherValue\n    this.yetAnotherValue\n    key=this.value\n  }}\n  as |value|\n>\n  {{value}}\n</SomeComponent>",
    ];
    using dir = tempDir(
      "format-short-cuts",
      Object.fromEntries(formatted.map((text, index) => [`${index}.hbs`, text])),
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

describe("code in Markdown and MDX", () => {
  // A fence, what follows it on its line and the formatted code are one text where nothing is indented.
  const blocks = [
    // The common shapes, one after the other, so that what is kept from one piece of code to the next shows.
    '```js\nconst  a=1\n```\n\n```ts\nconst  a:number=1\n```\n\n```css\na{color:red}\n```\n\n```scss\na{b{color:red}}\n```\n\n```json\n{"a":1}\n```\n\n```yaml\na:   1\n```\n\n```graphql\nquery{a}\n```\n\n```html\n<p>a</p>\n```\n\n```hbs\n{{a}}\n```\n\n```css\na{color:red}\n```\n\n```js\nconst  a=1\n```\n',
    // What follows the fence: a blank at its end goes away.
    "```js a \nb\n```\n\n```js a\t\nb\n```\n\n```js  two  blanks\nb\n```\n\n``` js\nb\n```\n\n```js {1,3}\nb\n```\n\n```js \\\nb\n```\n",
    // A line break in a text isn't one that the code is indented after.
    "```js\nlet a = `\n  b\n`;\n```\n\n```js\n/* a\n   b */\n```\n\n- ```js\n  let a = `\n    b\n  `;\n  ```\n\n> ```js\n> let a = `\n>   b\n> `;\n> ```\n",
    // An empty line in a text has the indentation of the host on it, one between two lines of code has nothing.
    '- a\n\n  ```vue\n  <style lang="stylus">\n  .a\n    color red\n\n  .b\n    color blue\n  </style>\n  ```\n\n> ```vue\n> <script lang="coffee">\n> a = 1\n>\n> b = 2\n> </script>\n> ```\n\n1. ```vue\n   <script>\n   const a = ;\n\n   const b = 2;\n   </script>\n   ```\n',
    '- ```vue\n  <custom>\n  a\n\n\n\n  b\n  </custom>\n\n  <style>\n  ---\n  a: 1\n  ---\n\n  a {\n  }\n  </style>\n  ```\n\n```vue\n<style lang="stylus">\n.a\n\n.b\n</style>\n```\n',
    '- ```js\n  const a = css`\n    a {\n      color: red;\n\n      /* c\n\n         d */\n\n      margin: 0;\n    }\n  `;\n  ```\n\n> ```js\n> const a = css`\n>   /* prettier-ignore */\n>   a   {\n>\n>   b:c }\n>   d { content: "x\\\n>\n> y" }\n> `;\n> ```\n',
    "> ```js\n> const h = html`\n>   <style>\n>     /* a\n>\n>      b */\n>     a {\n>       color: red;\n>     }\n>   </style>\n>   <script>\n>     // prettier-ignore\n>     const a = [\n>       1,0,\n>\n>       0,1,\n>     ];\n>   </script>\n> `;\n> ```\n",
    '- ```js\n  const m = markdown`\n    ~~~toml\n    a = 1\n\n\n\n    [b]\n    ~~~\n\n    ~~~yaml\n    a: |\n      x\n\n      y\n    ~~~\n  `;\n  ```\n\n> ```js\n> const h = html`\n>   <script type="importmap">a\n>\n>\n>   b</script>\n>   <script type="text/x-handlebars-template">\n>   a = b</script>\n> `;\n> ```\n',
    // Markup below the root has a parent all the same.
    '```html\n<div>\n  <style>\n    div {\n      & span[foo="bar short\\\n    short"] {\n        color: red;\n      }\n    }\n  </style>\n</div>\n```\n\n```html\n<style>\n  a b[c="dddddddddddddddddddddddddddddddddd\\\n  eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"] f {\n    color: red;\n  }\n</style>\n<script>\n  let  a\n</script>\n```\n',
    // The fence is longer than every run in the code, before and after.
    "````js\nfoo(`a\n```\nb`);\n````\n\n```js\n// ``\n```\n\n~~~js\n// ```\n~~~\n\n```md\n~~~js\nconst  a=1\n~~~\n```\n\n~~~md\n```js\nconst  a=1\n```\n~~~\n\n`````js\na\n`````\n",
    // Nothing in it, white space in it, white space at its end.
    "```js\n```\n\n```js\n\n```\n\n```js\n  \n```\n\n```js\na;  \n```\n\n```js\na;\n\n\n```\n\n```json\n```\n\n```yaml\n```\n\n```yaml\na: |\n  b  \n```\n\n```md\na  \n```\n",
    // Code that stays as it is.
    "```js\nconst = ;\n```\n\n```ts\nconst a = ...;\n```\n\n```css\na {\n```\n\n```json\n{\n```\n\n```sh\nls   -l\n```\n\n```\na   b\n```\n",
    // Not closed, and what is around it.
    "```js\nconst  a=1\n",
    "a\n```js\nconst  a=1\n```\nb\n\n<!-- prettier-ignore -->\n```js\nconst  a=1\n```\n\n<!-- prettier-ignore-start -->\n```js\nconst  a=1\n```\n<!-- prettier-ignore-end -->\n",
    " ```js\n const  a=1\n ```\n\n   ```js\n   const  a=1\n   ```\n\n1. a\n\n   ```js\n   const  a=1\n   ```\n",
    "﻿```js\nconst  a=1\n```\n",
    "```js\r\nconst  a=1\r\nlet b = `\r\n`;\r\n```\r\n",
  ];
  const frontMatter = [
    "---\na:   1\n---\n\nb\n",
    "---\n---\n\nb\n",
    "---\n\n---\n",
    "--- \na:   1\n---\n",
    "---yaml\na:   1\n---\n",
    "--- yaml\na:   1\n---\n",
    "---toml\na   = 1\n---\n",
    "+++\na   = 1\n+++\n",
    "---\na: |\n  b  \n---\n",
    '---\na: "b\n  c"\n---\n',
    "---\na: {\n---\n",
    "---\na:   1\n--- \n",
    "---\na:   1\n\n\n---\n",
    "---\r\na:   1\r\n---\r\n",
    "﻿---\na:   1\n---\n",
  ];
  describe("Markdown", () => expectSame("a.md", [...blocks, ...frontMatter], markdownOptions));
  describe("MDX", () => {
    const texts = [
      "import  a from 'a'\n\nexport const b = `\n  c\n`\n\nexport const d = 1  \n\n<A b={`\n  c\n`} />\n\n<A>{`a\n  b  \nc`}</A>\n\n<A\n  a={1}\n/>\n",
      "- a\n\n  <A b={1}  />\n\nexport const a = ;\n\n<A b={} />\n",
      // An element with nothing but words in it is written without JavaScript, whatever lines the words are on.
      `<Note>\n  ${"word ".repeat(30)}word\n</Note>\n\n<Note>\n${"word\n".repeat(30)}</Note>\n\n<Note>${"word ".repeat(30)}word</Note>\n\n<Note>\n  a\n  b\n</Note>\n\n<Note>\n    a  b\tc\n  </Note>\n`,
      // To the column.
      `<A>\n  ${"a".repeat(38)} ${"b".repeat(39)} c\n</A>\n\n<A>\n  ${"a".repeat(38)} ${"b".repeat(40)} c\n</A>\n\n<A>${"a".repeat(73)}</A>\n\n<A>${"a".repeat(74)}</A>\n\n<A>\n  ${"a".repeat(100)} b\n</A>\n`,
      // More than one attribute breaks it. A tag that doesn't fit is another matter.
      `<A b="c" d>e</A>\n\n<A b="c" d>\n  e f\n</A>\n\n<A b="${"c".repeat(90)}">\n  d   e\n</A>\n\n<A b d="${"c".repeat(90)}">\n  d   e\n</A>\n\n<A b='c'>\n  d   e\n</A>\n`,
      // White space next to a tag means something unless it has a line break in it.
      "<A> b   c</A>\n\n<A>b   c </A>\n\n<A> b   c </A>\n\n<A>\tb   c\n</A>\n\n<A> \n b   c \n </A>\n",
      // Small elements among the words: a blank next to one is `{" "}` where the line is broken, and a line can be
      // broken where there is nothing.
      `<A>\n  Exclude <code>dev</code>, <code>optional</code>, or <code>peer</code> dependencies from install and ${"word ".repeat(12)}<code>a</code> b\n</A>\n`,
      `<A>\n  ${"a".repeat(60)} <code>bbbbbb</code> c\n</A>\n\n<A>\n  ${"a".repeat(60)} <code>bbbbbbb</code> c\n</A>\n\n<A>\n  ${"a".repeat(61)}(<code>bbbbbb</code>) c\n</A>\n\n<A>\n  ${"a".repeat(64)} <code>b</code>, c\n</A>\n\n<A>\n  ${"a".repeat(65)} <code>b</code>, c\n</A>\n`,
      '<A><code>b</code></A>\n\n<A>b <code>c</code></A>\n\n<A>\n  <code>b</code>   c\n</A>\n\n<A>\n  b\n  <code>c</code>\n</A>\n\n<A>\n  <code>b</code>\n  c\n</A>\n\n<A>\n  <code>b</code><code>c</code>\n</A>\n\n<A>\n  <code>b</code> <code>c</code>\n</A>\n\n<A>\n  b{" "}\n  <code>c</code>\n</A>\n',
      `<A>\n  b <code>${"c".repeat(90)}</code> d\n</A>\n\n<A>\n  b <code> c</code> <code>d </code> <code>e  f</code> <code></code> <code g="h" i>j</code> <code>k<b>l</b></code> <br />\n</A>\n`,
      // `{" "}` in the text is a blank that stays.
      `<A>\n  ${"word ".repeat(13)}as <code>b:</code>;{" "}\n  <code>--c=D</code> targets <code>e.F</code>\n</A>\n\n<A>\n  a{" "}\n  <code>b</code>\n</A>\n\n<A>a{" "}b</A>\n\n<A>\n  a {" "} b{' '}c {" "}{" "} d\n</A>\n\n<A>\n  ${"a".repeat(40)}{" "}${"b".repeat(40)}\n</A>\n`,
      '<A>{" "}a   b</A>\n\n<A>a   b{" "}</A>\n\n<A>\n  {" "}\n  a   b\n</A>\n\n<A>\n  a   b{" "}\n</A>\n\n<A>{" "}</A>\n\n<A>\n  a{"  "}b   c\n</A>\n\n<A>\n  a{ " " }b   c\n</A>\n\n<A>\n  a{""}b   c\n</A>\n',
      // Words that aren't ASCII are as wide as the printer says.
      `<A>\n  ${"\u4e2d".repeat(19)} ${"\u6587".repeat(19)} c   d\n</A>\n\n<A>\n  ${"\u4e2d".repeat(19)} ${"\u6587".repeat(20)} c   d\n</A>\n\n<A>\n  ${"\u00e9".repeat(38)} ${"\u00e9".repeat(39)} c   d\n</A>\n\n<A>\n  \u26a1\ufe0f **a** \u2014 b   c\u2026\n</A>\n`,
      "<A>\n  \u200b\n</A>\n\n<A>\n  \u3000\n</A>\n\n<A>\n  \ufeff\n</A>\n\n<A>\n  \u2028\n</A>\n\n<A>\n  a\u00a0b   c\n</A>\n\n<A>\n  \u0301   a\u0301\n</A>\n\n<A>\n  \u0085   a\n</A>\n",
      // What isn't a word.
      "<A>\n  b   {c}\n</A>\n\n<A>\n  b   }\n</A>\n\n<A>\n  b   >\n</A>\n\n<A>\n  b   <B />\n</A>\n\n<A>\n  b   é\n</A>\n\n<A>\n  b     c\n</A>\n\n<A>\n  b   &amp; & `c` **d** \"e\" 'f' \\\n</A>\n",
      "<A>\n  b   c\n</B>\n\n<A>\n  b   c\n\n<A>\n  b   c\n</A> d\n\n<A>\n  b   c\n</A>\n<B />\n\n<fbt>\n  b   c\n</fbt>\n\n<pre>\n  b   c\n</pre>\n\n<A></A>\n\n<A>\n</A>\n",
      "{/* prettier-ignore */}\n<A>\n  b   c\n</A>\n\n<A>\n  b   c\n</A>\n",
      // Nothing is open that the first tag could close.
      '</A>\n<A>\n\n  </A>\n  <A b="c">\n\n</A>   b\n\n</A><A>b   c</A>\n\n</$>\n\n</>\n\n</ A>\n',
    ];
    expectSame(
      "a.mdx",
      [...blocks, ...frontMatter, ...texts],
      [
        ...markdownOptions,
        ["--print-width=40"],
        ["--print-width=30", "--use-tabs"],
        ["--jsx-single-quote"],
        ["--single-attribute-per-line"],
        ["--bracket-same-line"],
      ],
    );
  });
});

describe("templates in another language", () => {
  // A property whose value may be in another language isn't written as a line, whether or not the language's parser
  // takes it.
  const texts = [
    // How far the line of a template is indented, behind a byte order mark.
    '\ufeff    h = html`<script type="application/json">{"a":["aaaaaaaaaa","bbbbbbbbbb","cccccccccc","dddddddddd","eeeeeeeeee"]}</script>`;\n',
    '\ufeff\n    h = html`<script type="application/json">{"a":["aaaaaaaaaa","bbbbbbbbbb","cccccccccc","dddddddddd","eeeeeeeeee"]}</script>`;\n',
    '@Component({\n  selector: "a",\n  template: `<p>a</p>`,\n})\nclass A {}\n',
    '@Component({\n  selector: "a",\n  template: `\n    <div><p>a</p>\n    <p [b]="c+1">{{d}}</p></div>\n  `,\n  styles: `a{color:red}`,\n})\nclass A {}\n',
    // What the parser refuses stays as it is.
    '@Component({\n  selector: "a",\n  template: `<div`,\n})\nclass A {}\n',
    '@Component({\n  selector: "a",\n  template: `<p>{{</p>`,\n  styles: `a {`,\n})\nclass A {}\n',
    '@Component({\n  selector: "a",\n  styles: [`a {`, `b{color:red}`],\n})\nclass A {}\n',
    // Nothing in it.
    '@Component({\n  selector: "a",\n  template: ``,\n  styles: `  `,\n})\nclass A {}\n',
    // Not in a component.
    "const a = {\n  template: `<p>a</p>`,\n  styles: `a{color:red}`,\n  b: `c`,\n  d: `\n  e\n`,\n};\n",
    // By a comment.
    "const a = {\n  b: /* HTML */ `<p>a</p>`,\n  c: /* HTML */ `<div`,\n  d: /* GraphQL */ `query{a}`,\n  e: /* GraphQL */ `query{`,\n  f: /* CSS */ `a{color:red}`,\n};\n",
    // An escape that has no value.
    '@Component({\n  selector: "a",\n  template: `<p>\\u{</p>`,\n})\nclass A {}\n',
    '@Component({\n  selector: "a",\n  template: `<p>${a}</p>${b}`,\n})\nclass A {}\n',
    // Markup with all that a template of Angular has.
    '@Component({\n  selector: "a",\n  template: `\n    <div   class="a  b"  [title]="title | async"   (click)="onClick($event); other()">\n      <span *ngIf="items.length > 0; else empty">{{ items.length | number: \'1.0-0\' }} items</span>\n      <li *ngFor="let item of items; trackBy: trackById; let i = index" [class.active]="item.id === selected?.id && !disabled">{{item.name}}</li>\n      <ng-template #empty><p>nothing here, and this is a rather long text that has to be wrapped somewhere</p></ng-template>\n      <button type="button" (click)="save({ id: item.id, name: item.name, description: item.description, more: true })">Save</button>\n      @if (a > b) {\n        {{a}} is greater than {{b}}\n      } @else {\n        <b i18n="x|y@@z">c</b>\n      }\n      @for (item of items; track item.id; let idx = $index) { <li>{{item}}</li> } @empty { none }\n      @let name = user.name + "x";\n    </div>\n  `,\n  styles: [`\n    :host { display:block; color : red }\n    .a, .b > .c { margin: 0 auto; background: url(foo.png) no-repeat }\n  `],\n})\nexport class A {}\n',
    "@Component({ template: `<a>{{x}}</a>`, styles: `a{b:c}` })\nclass B {}\n@Component({ template: `<a>${x}</a><b></b>` })\nclass C {}\n@Component({ template: ` <a>${x}</a><b></b>` })\nclass D {}\n@Component({ template: `<a>${x}</a><b></b> ` })\nclass E {}\n@Component({ template: ` <a>${x}</a> ` })\nclass F {}\n",
    "@Component({ template: `<p title=\"a &quot;b&quot; 'c'\" [a]=\"'x' + &quot;y&quot;\" (b)=\"c = 'd'\">\\${{ price }} \\`x\\` \\\\ \\u00e9</p>` })\nclass A {}\n",
    '@Component({ template: `<div style="color:red;background:blue" onclick="a(1);b()" class="  b   a "><style>a{b:c}</style><script>let  a = `x${1}`</script><pre>\n  x\n</pre><textarea> a </textarea></div>` })\nclass A {}\n',
    '@Component({ template: `<a [b]="c // d"></a><a (b)="c; // d"></a>{{ a // b\n}}<i>{{}}</i><i a="{{ }}"></i>` })\nclass A {}\n',
    // Substitutions in every place of markup.
    'const h = html`<div class="${cls}" @click=${handler} ${attr} a${b}c="d${e}f">${content}  <p>text ${a + b} more</p><${tag}>x</${tag}></div>`;\nconst i = /* HTML */ `\n  <ul>${items.map(i => html`<li>${i}</li>`)}</ul>\n`;\nfoo(html`<a>${veryLongFunctionName(withSomeArguments, andSomeMoreArguments, andEvenMoreArgumentsThanThat)}</a>`);\nconst f = () => html`<b>${x}</b>`;\n',
    "o(html`\n<${b}>`);\na.c(/* HTML */ ` <${b}><script></script>\n`).d();\n",
    "a = html`<script>html\\`<a>\\${b}</a>\\`</script>${c}`;\n",
    // A text of nothing but white space, as it is written or by its escapes.
    "a = graphql`\u00a0`;\nb = css`\ufeff`;\nc = html`\u2028`;\nd = markdown`\u3000`;\n@Component({ template: `\u00a0`, styles: `\u2028` })\nclass A {}\n",
    "@Component({ template: `\\ ` })\nclass A {}\n@Component({ template: `\\t` })\nclass B {}\na = graphql`\\\n`;\nb = html`\u00a0<a></a>\u00a0`;\n",
    // Style sheets.
    "const s = styled.div`\n  color: ${props => props.color};\n  ${mixin};\n  margin: ${a}px ${b}px;\n  ${Button}:hover & { a: b }\n  /* c\n     d */\n  // e\n`;\nconst t = styled(Foo).attrs({ a: 1 })`a{b:c}`;\nfoo(css`a{b:c}`);\nconst f = () => css.global`a{b:c}`;\n",
    "x = css`2:a //\n${(a,b)}`;\ny = css`v{grid-template:''\n${tionName(MoreArguments,andEvenMoreArgumentsThanThat)}'main sidebar'}`;\n",
    'a = css`& [="\n"]{}`;\nb = css`a [b="\n"], c{}`;\nc = css`a{b: "x\\\n y" c}`;\n',
    "a = css`---\ne:\n-\n---s{}`;\n",
    "function f(){return css.resolve`@use\"\"(n:(,,))''`}\n",
    "o={a:css.global`@import(//\n}${a})`}\n",
    "a = css`a{b:@prettier-placeholder-7-id}`;\nb = css`a{b:${c} @prettier-placeholder-7-id}`;\nc = css`a{${b}`;\n",
    // Queries.
    "const q = gql`\n  query Foo($a: Int) { a(b: $a) { c d } }\n\n  ${fragment}\n\n  # comment\n  ${other}\n`;\nconst r = graphql(schema, `{ a }`);\nconst s = /* GraphQL */ `{ a }`;\nconst t = graphql.experimental`{a}`;\n",
    's={a:/* GraphQL */`#\\ud800`}\nt = gql`{ a(b: "\\\\") }`;\nu = gql`# a ${b}`;\nv = gql`\n# a\n\n# b\n`;\nw = gql`{a}\u00a0`;\n',
    // What is left as it is, on several lines.
    "a = gql`\n  # prettier-ignore\n  type A {\n    a:   Int\n  }\n`;\nb = gql`\n  # prettier-ignore\n  type A {\n    a:   Int\n  }\n\n  ${c}\n`;\n",
    'a = gql`\n  {\n    # prettier-ignore\n    a(b:   """\n      c\n    """)\n  }\n`;\nb = gql`\n  """\n  c\n\n  d\n  """\n  type A\n`;\n',
    "a = css`\n  /* b\n     c */\n  // prettier-ignore\n  d   {\n    e:   f;\n  }\n`;\nb = html`\n  <!-- prettier-ignore -->\n  <p>\n    a   b\n  </p>\n  <pre>\n  c\n  </pre>\n`;\n",
    "a = markdown`\n  <!-- prettier-ignore -->\n  | a | b |\n  |--|--|\n\n  \\`\\`\\`\n  c\n\n  d\n  \\`\\`\\`\n`;\n",
    // Markdown.
    "const m = markdown`\n  # Title\n  * a\n  * b\n\n  some   text\n`;\nconst n = md`\n# Title\n\n\\`\\`\\`js\nlet  a\n\\`\\`\\`\n`;\n",
    "someFunction(markdown`>c\n`);\na.c(md`>c\n`).d();\nmd`a|||\n-|-|-`;\na=markdown` \\`\n\\``;\nconst b=await foo(async()=>md` this is a long long long long long long long long paragraph.`);\n",
    // What is nearly a template in another language, or is one in two.
    "graphql?.(`{a{b}}`);\nx=graphql?.(` `);\ngraphql?.(`${f()}`);\na?.graphql(`{a{b}}`);\nnew graphql(`{a}`);\ngraphql(a)(`{a}`);\n",
    "x = /* GraphQL */ css`{ a }`;\nx = /* GraphQL */ css`a{`;\nx = /* GraphQL */ md`{ a`;\nx = /* HTML */ markdown`<a`;\nx = /* HTML */ gql`{a}`;\nx = /* HTML */ /* GraphQL */ `{a}`;\n",
    'x = styled?.div`a{b:c}`;\nx = styled["div"]`a{b:c}`;\nx = css.foo`a{b:c}`;\nx = (styled.div)`a{b:c}`;\nx = html.foo`<a></a>`;\nx = /*GraphQL*/ `{a}`;\nx = /** GraphQL */ `{a}`;\n',
    "@Component({ 'template': `<a></a>` })\nclass A {}\n@ng.Component({ template: `<a></a>` })\nclass B {}\n@Component({ a: { template: `<a></a>` } })\nclass C {}\n@Component({ styles: [[`a{b:c}`]] })\nclass D {}\n@Component({ template: (`<a></a>`) })\nclass E {}\nComponent({ template: `<a></a>` });\n",
    // A template in a substitution of a template, on another line.
    '(html`<script type="text/x-handlebars-template"><div><h1></h1><div></div></div></script><script>\n  ${(m>html`<`)}</script>`)\n',
    // A text without width.
    "/* HTML */` he fix happened. \u000b\n`;\n",
  ];
  expectSame("a.ts", texts, [
    [],
    ["--embedded-language-formatting=off"],
    ["--print-width=20"],
    ["--print-width=1"],
    ["--use-tabs"],
    ["--tab-width=0"],
    ["--end-of-line=crlf"],
    ["--end-of-line=cr"],
    ["--html-whitespace-sensitivity=ignore"],
    ["--html-whitespace-sensitivity=strict", "--print-width=40"],
    ["--prose-wrap=never"],
    ["--prose-wrap=always", "--print-width=30"],
    ["--print-width=9"],
    ["--single-quote", "--bracket-same-line", "--single-attribute-per-line"],
    ["--use-tabs", "--tab-width=8", "--print-width=60"],
  ]);
});

describe("JavaScript that is deep, long or full of comments", () => {
  // What is written behind a deep nest or a long chain has to find room in the buffers: nothing of the output may be missing.
  const nest = (open: string, middle: string, close: string, depth: number) =>
    `x = ${open.repeat(depth)}${middle}${close.repeat(depth)};\n`;
  describe("nests and chains", () =>
    expectSame(
      "a.jsx",
      [
        nest("", "a", "()", 7000),
        nest("", "a", "(b)", 5000),
        nest("", "a", ".b()", 5000),
        nest("", "a", "[0]", 7000),
        nest("a ? b : ", "c", "", 5000),
        nest("", "a", ".b", 20000),
        // The frames of such a build are larger, and the long way's more so: it runs out of stack first.
        ...(isDebug || isASAN
          ? []
          : [
              nest("{a:", "1", "}", 2700),
              nest("[", "", "]", 2700),
              nest("<a>", "", "</a>", 2700),
              nest("f(", "", ")", 2700),
            ]),
      ],
      [["--use-tabs"]],
    ));

  // Whoever writes in a loop makes room in it. What is written where there is none is lost, and the file goes the long way after all.
  test.skipIf(!hasFlag).concurrent.each([4000, 4300, 32000])("a chain of %d calls goes the quick way", async count => {
    using dir = tempDir("format-short-cuts", { "a.js": nest("", "a", ".b()", count) });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fmt", "--check", "--bench=1", "--threads=1", "--no-config", "--no-editorconfig", "a.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout + stderr).toContain("the quick way: 1 scripts");
  });

  // The text of a template is searched for what ends it or needs a look, some bytes at a time: whatever that is, wherever it stands.
  describe("what stands in a template", () => {
    const lengths = [0, 1, 7, 8, 15, 16, 17, 31, 32, 33, 47, 48, 49, 63, 64, 65, 79, 80, 81, 127, 128, 129, 300];
    const stops = [
      "",
      "${b}",
      "$",
      "$$",
      "$ {",
      "\\`",
      "\\\\",
      "\n",
      "\n\n",
      " \n",
      "\t",
      "\x7f",
      "é",
      "😀",
      "\\\n",
      "\\é",
      "\\${",
      "$\\{",
      "{",
      "}",
    ];
    expectSame(
      "a.js",
      lengths.flatMap(length =>
        stops.flatMap(stop => [
          `x = \`${"a".repeat(length)}${stop}${"a".repeat(length)}\`;\n`,
          `x = \`${"a".repeat(length)}${stop}`,
        ]),
      ),
      [[], ["--end-of-line=crlf"], ["--print-width=20", "--use-tabs"]],
    );
  });

  // Where a comment belongs is asked of what stands next to it, comments aside, whatever separates them.
  const ascii = [" ", "\t", "\n", "\r\n", "\r", "\x0b", "\x0c", "", ",", ";", " , "];
  const beyondAscii = ["\u00a0", "\u2028", "\u2029", "\ufeff", "\u3000"];
  const rows = (separators: string[], count: number) =>
    separators.flatMap(separator => [
      `a(${`/* c */${separator}`.repeat(count)}b);\n`,
      `a;\n${`/* c */${separator}`.repeat(count)}\n`,
      `function f() ${`/* c */${separator}`.repeat(count)}{}\n`,
      `x = [${`/* c */${separator}`.repeat(count)}];\n`,
    ]);
  describe("rows of comments", () =>
    expectSame(
      "a.js",
      [3, 511, 513, 3000]
        .flatMap(count => rows(ascii, count))
        .concat([513, 3000].flatMap(count => rows(beyondAscii, count))),
      [[]],
    ));

  // A row is looked through once, not once for each of its comments.
  test.skipIf(!hasFlag)("many rows of 500 comments take no longer than on the long way", async () => {
    const row = "/* c */ ".repeat(500);
    const times = isDebug || isASAN ? 25 : 100;
    using dir = tempDir("format-short-cuts", {
      "a.js": `a(${row}b);\n`.repeat(times),
      "b.js": `x = [${row}];\n`.repeat(times),
      "c.js": `function f() ${row}{}\n`.repeat(times),
    });
    const cpu = async (own: string[]) => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "fmt",
          "--check",
          "--no-config",
          "--no-editorconfig",
          "--log-level=silent",
          "--threads=1",
          ...own,
          ".",
        ],
        cwd: String(dir),
        env: bunEnv,
        stdout: "ignore",
        stderr: "ignore",
      });
      await proc.exited;
      // (Windows counts in ticks of 1/64 s)
      return Math.max(Number(proc.resourceUsage()?.cpuTime.total ?? 0) / 1e6, 1 / 64);
    };
    // 0.8 in a release build, and 12 when each comment looked past its row.
    expect((await cpu([])) / (await cpu(["--no-short-cuts"]))).toBeLessThan(4);
  });

  // What is asked about every item of a list, every comment of a row or every token of a line is not answered by going through the list, the row or the line.
  // A row has the name of the file, what stands before the unit, the unit, what stands behind it, how many units the shorter text has, and flags. A unit "a¦b¦c" is a
  // nest: so many times "a", then "b", then so many times "c". With these numbers the longer text took 12 to 16 times as long as the shorter one, between 0.3 s and 2 s in a
  // release build, when the time grew with the square of the length.
  type Shape = [name: string, before: string, unit: string, after: string, count: number, flags?: string[]];
  const textOf = ([, before, unit, after]: Shape, count: number) => {
    const [open, middle, close] = unit.includes("¦") ? unit.split("¦") : [unit, "", ""];
    return before + open.repeat(count) + middle + close.repeat(count) + after;
  };
  const shapes: Shape[] = [
    // whether TypeScript without a name is tried with JSX first
    ["a.vue", '<script lang="ts">\nx = \'', "</b>", "';\n</script>\n", 5000],
    ["a.vue", '<script lang="ts">\n// ', "<a/> ", "\n</script>\n", 4000],
    // what follows a `<<` on its line
    ["a.ts", "x = [", "1 << 2, ", "];\n", 4000],
    // blocks that have been read, in a statement that is parsed again
    ["a.js", "if (a) {\n  x;\n}", " else if (b) {\n  y;\n}", " else z;\n", 8000],
    // doc comments that start where another one ends
    ["a.js", "", "/**\n * a\n *//**\n * b\n */\na;\n", "", 4000],
    // the child before an element
    ["a.jsx", "x = <a>\n", "{/* c */}\n<b />\n", "</a>;\n", 4000],
    // separators between children that go
    ["a.jsx", "x = <a>", "{b} c ", "</a>;\n", 3000],
    ["a.jsx", "x = <a>\n", "word {a} <b /> text\n", "</a>;\n", 1500],
    // the flags of a regular expression
    ["a.ts", "x = /a/", "ysmig", ";\n", 5000],
    // the line on which a template starts
    ["a.js", "x = [", `html\`<a></a>\`, "${"a".repeat(200)}", `, "];\n", 3000],
    // conditionals in the test of a conditional (on one line: broken, each is indented by one level more)
    ["a.js", "x = ", "(¦a¦ ? b : c)", ";\n", 3000, ["--print-width=10000000"]],
    ["a.jsx", "x = ", "(¦<a />¦ ? b : c)", ";\n", 3000, ["--print-width=10000000"]],
    ["a.jsx", "x = ", "(¦a¦ ? b : c)", " ? <b /> : c;\n", 3000, ["--print-width=10000000"]],
    // `a || (b || c)` is `(a || b) || c`
    ["a.js", "x = ", "a || (¦a¦)", ";\n", 1500],
    ["a.js", "x = ", "z || ((¦a¦) || (p || q))", ";\n", 700],
    // a row of comments
    ["a.js", "a(", "/* c */ ", "b);\n", 8000],
    ["a.js", "a;\n", "/* c */ ", "\n", 8000],
    ["a.js", "function f() ", "/* c */ ", "{}\n", 8000],
    ["a.js", "function f(", "/* c */ ", ") {}\n", 8000],
    ["a.js", "if (a) b; ", "/* c */ ", "else c;\n", 8000],
    ["a.js", "x = !(a &&\n b ", "/* c */ ", ");\n", 8000],
    ["a.js", "x = { a ", "/* c */ ", "() {} };\n", 8000],
    ["a.js", "", "/**\n * c\n */", "\na;\n", 8000],
    ["a.ts", "type A = ", "/* c */ ", "| B | C;\n", 8000],
    ["a.ts", "type A = { ", "/* c */ ", "[K in B]: C };\n", 8000],
    // two long lists of a node that stand in another order in the text
    ["a.js.flow", "declare class A mixins ", "B, ¦C implements ¦D, ", "E {\n  // c\n  a: F;\n}\n", 4000],
  ];
  describe("four times the text takes about four times as long", () => {
    test.concurrent.each(shapes)("%s: %j, %j, %j", async (...shape) => {
      const [name, , , , count, flags = []] = shape;
      const short = Math.ceil(count / (isDebug || isASAN ? 2 : 1));
      using dir = tempDir("format-short-cuts", {
        [`1/${name}`]: textOf(shape, short),
        [`4/${name}`]: textOf(shape, 4 * short),
      });
      const cpu = async (file: string) => {
        await using proc = Bun.spawn({
          cmd: [
            bunExe(),
            "fmt",
            "--check",
            "--no-config",
            "--no-editorconfig",
            "--log-level=silent",
            "--threads=1",
            ...flags,
            file,
          ],
          cwd: String(dir),
          env: bunEnv,
          stdout: "ignore",
          stderr: "ignore",
        });
        await proc.exited;
        // (Windows counts in ticks of 1/64 s)
        return Math.max(Number(proc.resourceUsage()?.cpuTime.total ?? 0) / 1e6, 1 / 64);
      };
      expect((await cpu(`4/${name}`)) / (await cpu(`1/${name}`))).toBeLessThan(8);
    });
  });
  describe("the same shapes, short", () => {
    for (const name of new Set(shapes.map(shape => shape[0]))) {
      describe(name, () =>
        expectSame(
          name,
          shapes
            .filter(shape => shape[0] === name)
            .flatMap(shape => [1, 2, 3, 4, 40].map(count => textOf(shape, count))),
          [[], ["--print-width=20"]],
        ),
      );
    }
  });
});

describe("JavaScript and TypeScript in a host", () => {
  // A script or a code block is formatted to a text of its own, which the host puts between two of its lines.
  const statements = [
    // The common shapes.
    "const  a=1",
    "import  {a} from 'a'\nexport default {\n  name: 'b',\n  data() { return { c: 1 } },\n}",
    "function f(a,b){\n  if(a){return b}\n  return a\n}\n\n\nclass A extends B{\n  c=1\n  d(){}\n}",
    // A line break in a text: what follows it isn't indented, and has all of the line.
    "const a = `\n  b\n`;",
    "const a = `\n  b  \n\n  ${c}\n    d`;",
    "function f() {\n  return `\n    a\n  `;\n}",
    "foo(`a\n`, bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, cccccccccccccccccccccccccccccccc, ddddddddddddd);",
    "foo(`a\n`, bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, cccccccccccccccccccccccccccccccc, dddddddd);",
    "/* a\n   b */\nc;",
    "function f() {\n  /* a\n     b */\n  c;\n}",
    "/**\n * a\n */\nb;\n\n/**\n   * c\n   */\nd;",
    'a = "b\\\nc";',
    "x = <div>\n  {`a\n  b`}\n</div>;",
    '<a b="c\nd" />;',
    // What is asked of the width of the line, not of what is left of it.
    'const aaaaaaaaaaaaaaaaaaaaaaaaa = document.getElementById("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");',
    'const aaaaaaaaaaaaaaa = bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.cccccccccccccccccc("dddddddddddddddd");',
    'const aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa = bbbbbbbbbbbbbbbbbbbbbb("cccccccccccccccccccc");',
    // To the column.
    `const a = ${"b".repeat(66)};`,
    `const a = ${"b".repeat(67)};`,
    `const a = ${"b".repeat(68)};`,
    `const a = ${"b".repeat(69)};`,
    `const a = ${"b".repeat(70)};`,
    `f(${"a".repeat(36)}, ${"b".repeat(36)});`,
    `f(${"a".repeat(37)}, ${"b".repeat(37)});`,
    // Nothing but an element.
    "<a />;",
    "<a />",
    "<a>b</a>",
    "(<a>b</a>)",
    "// c\n<a />;",
    "<a />;\nb;",
    '"use strict";\n<a />;',
    // An element, a line break and text, where neither fits: one line break between them.
    "x = <a>\n  <code>b</code>\n  c d\n</a>;",
    'x = <a>the a.\n  <code>a</code>\n    a{" "}\na it\'s\n  </a>;',
    // What is one thing in a file and another in a host.
    "// @flow\nconst a: number = 1;",
    "/* @flow */\ntype A = {| a: 1 |};",
    "// @format\na;",
    "// prettier-ignore\na  =  1;",
    "#!/usr/bin/env node\na;",
    "<!-- a\nb;",
    "a;\n--> b",
    "while (n --> 0) {}",
    "a <!--b;",
    "await a;",
    "await (a);",
    "const await = 1;",
    'import("a");',
    "import.meta.url;",
    "with (a) {}",
    "var yield = 1;",
    "return 1;",
    "﻿a;",
    // TypeScript, with and without JSX.
    "const a = <T,>(b: T) => b;",
    "const a = <T>(b: T) => b;",
    "const a = <T>b;",
    "const a = <div>b</div>;",
    "let a: number = 1;\ntype A = { a: 1 };\nenum B { C }",
    "defineProps<{ a: string }>();\nconst b = withDefaults(defineProps<C>(), { d: 1 });",
    // Code in another language in it.
    "a = css`\n  color: red;\n`;",
    "a = html`<p>a</p>`;",
    "a = /* HTML */ `<script>b</script>`;",
    "a = gql`\n  query { a }\n`;",
    "a = markdown`\n  # a\n`;",
    // What can't be formatted.
    "const = ;",
    "a b",
    "`",
    "/*",
    "}",
    // Nothing, or as good as nothing.
    "",
    " ",
    "\n\n",
    ";",
    "// a",
    "/* a */",
  ];
  const options = [
    [],
    ["--vue-indent-script-and-style"],
    ["--vue-indent-script-and-style", "--use-tabs"],
    ["--vue-indent-script-and-style", "--tab-width=4", "--print-width=60"],
    ["--tab-width=4"],
    ["--tab-width=0"],
    ["--tab-width=5000"],
    ["--use-tabs"],
    ["--print-width=1"],
    ["--print-width=40"],
    ["--print-width=100000"],
    ["--end-of-line=crlf"],
    ["--end-of-line=cr"],
    ["--no-semi", "--single-quote"],
    ["--embedded-language-formatting=off"],
    ["--insert-pragma"],
  ];
  const indented = (code: string, by: string) => code.replace(/^(?=.)/gm, by);

  describe("Vue", () => {
    const tags = ["<script>", '<script setup lang="ts">', '<script lang="tsx">', '<script lang="jsx">'];
    expectSame(
      "a.vue",
      [
        ...tags.flatMap(tag => statements.map(code => `${tag}\n${code}\n</script>\n`)),
        ...statements.map(code => `<script setup lang="ts">\n${indented(code, "  ")}\n</script>\n`),
        // What is around the code.
        '<script setup lang="ts">const  a=1</script>\n',
        '<script setup lang="ts">   const  a=1\n   </script>\n',
        '<script setup lang="ts">\n\n\nconst  a=1\n\n\n</script>\n',
        '<script setup lang="ts"></script>\n',
        '<script setup lang="ts">\n</script>\n',
        '<script setup lang="ts" generic="T  extends A,U">\nconst  a=1\n</script>\n',
        '<script lang="ts">\nexport default {}\n</script>\n\n<script setup lang="ts">\nconst  a=1\n</script>\n\n<template>\n  <div>{{ a }}</div>\n</template>\n\n<style>\na{color:red}\n</style>\n',
        '<script src="a.js">\nconst  a=1\n</script>\n',
        '<script lang="coffee">\na  =  1\n</script>\n',
        '<script lang="ts">\nconst  a=1\n</script>text\n',
        '<script lang="ts">\nconst  a=1\n</script><b>c</b>\n',
        '<script lang="ts">\nconst  a=1\n',
        '<template>\n  <div>\n    <script lang="ts">\n      const  a=1\n    </script>\n  </div>\n</template>\n',
        '<custom lang="ts">\nconst  a=1\n</custom>\n',
        '<script setup lang="ts">\r\nconst  a=1\r\nconst b = `\r\n`\r\n</script>\r\n',
        '﻿<script setup lang="ts">\nconst  a=1\n</script>\n',
      ],
      options,
    );
  });

  describe("expressions of Vue", () => {
    // The start tag is on one line, or the attribute is on a line of its own: what is printed for it is known there.
    const expressions = [
      // Printed as they are written but for the quotes, blanks or parentheses.
      "t('a.b')",
      "a['b']",
      "a ? 'b' : 'c'",
      "a+b",
      "(a)",
      "(a, b)",
      "(a || b) && c",
      "!(a <= b)",
      "a  ?  b  :  c",
      "[a,b]",
      "{a:1}",
      "{ a: 1, 'b-c': d, [e]: f, ...g }",
      "{ 'a': 1 }",
      "{ 1: a, 'b': c }",
      "{ '': 1, 1: 2 }",
      "`a${b}c`",
      "`a\n${b}`",
      "a as string",
      "(a as string[] | undefined)",
      "a!",
      "<T>a",
      "(e) => f(a, e as KeyboardEvent)",
      "(e: DragEvent) => f(e, i)",
      "e => f(e)",
      "async () => { await a }",
      "function () { return 1 }",
      "a = b",
      "a = b, c = d",
      "a++",
      "f(); g()",
      "if (a) b",
      "a | b",
      "a | b(c) | d",
      "a || b | c",
      "new A()",
      "typeof a === 'b'",
      "await a",
      "<div />",
      // What breaks, whether it fits or not.
      "{\n  a: 1 }",
      "{\n      a: 1,\n      b: { c: 2 },\n    }",
      "[\n  a, b]",
      "[{ a: 1 }, { b: 2 }]",
      "[\n      { required: true, message: 'age is required' },\n      { type: 'number', message: 'age must be a number' },\n    ]",
      "a.b().c().d().e()",
      // What doesn't fit.
      `[ns.b(), ns.is('disabled', disabled), ns.is('focus', focus), ns.is('bordered', border), ns.is('checked', a === b)]`,
      `{ top: cursorTop + 'px', left: cursorLeft + 'px', backgroundColor: displayedColor, lineHeight: height }`,
      `parentMenu.type.name === 'ElMenu' && rootMenu.props.collapse && $slots.title && somethingElse.that.is.long`,
      `sourceVisible ? locale['hide-source-of-the-example-code'] : locale['view-source-of-the-example-code']`,
      `handleAction(distinguishCancelAndClose ? 'close' : 'cancel', anotherArgument, andOneMoreArgument, last)`,
      `${"a".repeat(30)}.${"b".repeat(30)}.${"c".repeat(30)}`,
      `(event) => handleDragOver(event, index, anotherArgumentOfTheHandler, andOneMoreArgumentOfTheHandler)`,
      // To the column.
      ...[52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62].map(length => `f(${"a".repeat(length)}, b)`),
      // What is written in another way in an attribute.
      "'\"'",
      "a &amp;&amp; b",
      "a && b",
      "'&quot;'",
      "'it\\'s'",
      "'a' + &quot;b&quot;",
      "(a || b) && !c",
      "[a && 'b', c]",
      "a&&b",
      "a & b",
      "a &&= b",
      "'&amp;'",
      "'&nbsp;' + a",
      "a == &apos;b&apos;",
      "'&apos;'",
      "a &lt; b",
      `(aaaaaaaaaaaaaaaaaaaaaaaaaa === 'bbbbbbbbbbbbbbbbbb' || cccccccccccccccccccc) && (dddddddddddddddd || e < f)`,
      // Comments.
      "a // b",
      "a /* b */",
      "/* a */ b",
      // What can't be read.
      "",
      " ",
      "a b",
      "a) + (b",
      "a); (b",
      "a,",
      "{",
      "}}",
      "'",
      "a \u00e9",
      "'\u4e2d\u6587'",
    ];
    const names = [
      ":a",
      "v-if",
      "@a",
      "v-bind:a",
      ".a",
      ":class",
      "v-model",
      "v-for",
      "#a",
      ":aaaaaaaaaaaaaaaaaaaaaaaa",
    ];
    const script = '\n<script setup lang="ts">\nlet a;\n</script>\n';
    // Names on the left side, and what is more than a name.
    const lefts = [
      "a",
      "(a)",
      "(a, b)",
      "(a,b)",
      "( a , b )",
      "a, b",
      "(a, b, c)",
      "(a, b, c, d)",
      "(a, a)",
      "(a, , b)",
      "{ a }",
      "({ a, b }, c)",
      "[a, b]",
      "(a = 1, b)",
      "await",
      "(let, b)",
      "null",
      "(a, true)",
      "undefined",
      "type",
      "\u00e9",
      `(${"a".repeat(20)}, ${"b".repeat(20)})`,
      `(${"a".repeat(30)}, ${"b".repeat(30)})`,
    ];
    const rights = [
      "b",
      "10",
      "a.b",
      "f(c)",
      "f( c )",
      "a.concat([{} as any])",
      "[1,2]",
      "{ a: 1 }",
      "a.slice(\n      b\n    )",
      "a in b",
      "a && b",
      "a | b",
      "",
      "a b",
      `${"c".repeat(30)}.${"d".repeat(30)}`,
      `${"c".repeat(20)}.filter((it) => it.${"d".repeat(20)} && it.${"e".repeat(20)})`,
      ...[22, 23, 24, 25, 26, 27, 28, 29, 30].map(length => `f(${"c".repeat(length)}, ${"d".repeat(30)})`),
    ];
    // One file for a shape, with an element for every expression: an expression that can't be read stays as it is written.
    // What could end its attribute or its braces has a file of its own.
    const file = (elements: string[], end: string) => `<template>\n${elements.join("\n")}\n</template>\n${end}`;
    const shapes: [RegExp, string, (code: string) => string][] = [
      ...names.map(name => [/"/, script, (code: string) => `  <div ${name}="${code}"></div>`] as [RegExp, string, any]),
      [/"/, "", code => `  <div :a="${code}"></div>`],
      [/"/, script, code => `  <a :b="${code}" />`],
      [
        /"/,
        script,
        code => `  <div>\n    <div>\n      <el-button c="d" :b="${code}" e>f</el-button>\n    </div>\n  </div>`,
      ],
      [/"/, script, code => `  <span :b="${code}">c</span>d`],
      [/"/, script, code => `  <pre :b="${code}">\nc</pre>`],
      [/[{}<]/, script, code => `  <p>{{ ${code} }}</p>`],
      [/[{}<]/, "", code => `  <p>{{ ${code} }}</p>`],
      [/[{}<]/, script, code => `  <p>\n    {{ ${code} }}\n  </p>`],
      [/[{}<]/, script, code => `  <p>a {{ ${code} }} b</p>`],
      [/[{}<]/, script, code => `  <p>{{${code}}}<b>c</b></p>`],
    ];
    expectSame(
      "a.vue",
      [
        ...lefts.flatMap(left => [
          file(
            rights.map(right => `  <div v-for="${left} in ${right}"></div>`),
            script,
          ),
          file(
            rights.map(right => `  <li v-for="${left}  of  ${right}" :key="a">b</li>`),
            "",
          ),
        ]),
        ...shapes.flatMap(([alone, end, element]) => [
          file(expressions.filter(code => !alone.test(code)).map(element), end),
          ...expressions.filter(code => alone.test(code)).map(code => file([element(code)], end)),
        ]),
      ],
      [
        ...options,
        ["--tab-width=8"],
        ["--tab-width=3", "--print-width=60"],
        ["--quote-props=consistent"],
        ["--quote-props=preserve"],
        ["--no-bracket-spacing"],
        ["--arrow-parens=avoid"],
        ["--trailing-comma=none"],
        ["--object-wrap=collapse"],
        ["--bracket-same-line"],
        ["--single-attribute-per-line"],
        ["--experimental-operator-position=start"],
        ["--experimental-ternaries"],
      ],
    );
  });

  describe("HTML", () => {
    const at = (depth: number, tag: string, code: string) => {
      const names = ["html", "body", "div", "section", "main"].slice(0, depth);
      const open = names.map((name, level) => `${"  ".repeat(level)}<${name}>\n`).join("");
      const close = names
        .map((name, level) => `${"  ".repeat(level)}</${name}>\n`)
        .reverse()
        .join("");
      const by = "  ".repeat(depth);
      return `${open}${by}${tag}\n${indented(code, `${by}  `)}\n${by}</script>\n${close}`;
    };
    expectSame(
      "a.html",
      [
        ...statements.map(code => at(0, "<script>", code)),
        ...statements.map(code => at(2, "<script>", code)),
        ...statements.map(code => at(5, "<script>", code)),
        ...statements.map(code => at(1, '<script type="module">', code)),
        ...statements.map(code => at(1, '<script lang="ts">', code)),
        ...statements.map(code => `<script>\n${code}\n</script>\n`),
        '<script type="text/babel">\n  const  a=<b/>\n</script>\n',
        '<script type="text/babel" data-type="module">\n  import  a from "a"\n</script>\n',
        '<script type="application/javascript">\n  const  a=1\n</script>\n',
        '<script type="text/x-template">\n  const  a=1\n</script>\n',
        // The end tag, or the start tag, isn't on a line of its own.
        "<div>a<script>\n  const  a=1\n</script>b</div>\n",
        "<span><script>\n  const  a=1\n</script></span>\n",
        "<b>c</b><script>\n  const  a=1\n</script><b>d</b>\n",
        "<script>const  a=1</script><script>const  b=1</script>\n",
        "<pre>\n<script>\n  const  a=1\n</script>\n</pre>\n",
        "<script>\n  const  a=1\n",
        "<!-- prettier-ignore -->\n<script>\n  const  a=1\n</script>\n",
      ],
      options,
    );
  });

  describe("Markdown and MDX", () => {
    const languages = ["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts"];
    const texts = [
      ...statements.flatMap(code => [
        `\`\`\`js\n${code}\n\`\`\`\n`,
        `\`\`\`tsx\n${code}\n\`\`\`\n`,
        `- a\n\n  \`\`\`jsx\n${indented(code, "  ")}\n  \`\`\`\n`,
        `> \`\`\`ts\n${code.replace(/^/gm, "> ")}\n> \`\`\`\n`,
      ]),
      ...languages.map(language => `\`\`\`${language}\nconst  a=<b/>\nawait c\n\`\`\`\n`),
      // Code that is formatted already is part of the text around it. What only looks like it isn't.
      "a\n\n```js\nconst a = 1;\n\nfunction f() {\n  return {\n    b: 1,\n  };\n}\n```\n\nb\n",
      '```ts\nimport { a } from "a";\n\n// b\nexport class A {\n  b = 1;\n\n  c(): void {\n    d();\n  }\n}\n\ninterface B {\n  c: number;\n}\n```\n',
      "```js\nconst a = 1; \n```\n\n```js\nconst a = 1;\n\n```\n\n```js\n\nconst a = 1;\n```\n\n```js\nconst a = 1;\n\n\nconst b = 1;\n```\n\n```js\n const a = 1;\n```\n",
      "```js\nconst a = 1; // b\n```\n\n```js\nconst a = 1; // b \n```\n\n```js\nconst a = 1;  // b\n```\n\n```js\n// a\n\n// b\n```\n\n```js\nif (a) {\n  // b\n\n  // c\n}\n```\n",
      "```js\nconst a = {\n  b: 1\n};\n```\n\n```js\nconst a = {\n  b: 1,\n};\n```\n\n```js\nconst a = { b: 1 };\n```\n\n```js\nconst a = {\n  b: {\n    c: 1,\n  },\n};\n```\n",
      "```js\nconst a = 'b';\n```\n\n```js\nconst a = \"b\";\n```\n\n```js\nconst a = 1\n```\n\n```js\nf((a) => a);\n```\n\n```js\nf(a => a);\n```\n",
      `\`\`\`js\nconst a = ${"b".repeat(69)};\n\`\`\`\n\n\`\`\`js\nconst a = ${"b".repeat(70)};\n\`\`\`\n\n\`\`\`js\nconst a =\n  ${"b".repeat(70)};\n\`\`\`\n`,
      "```js\nif (a) {\n  b();\n} else {\n  c();\n}\n\ntry {\n  d();\n} catch (e) {\n  f();\n} finally {\n  g();\n}\n```\n",
      "```js\nif (a) {\n\tb();\n}\n```\n\n```js\nif (a) {\n    b();\n}\n```\n",
      "```js\nconst a = 1;\n// @flow\n```\n\n```js\n// prettier-ignore\nconst a = 1;\n```\n\n```js\nconst a = 1; // prettier-ignore\nconst  b = 1;\n```\n",
      '```js\nconst a = `b`;\n```\n\n```js\nconst a = css`b`;\n```\n\n```js\nconst a = 中;\n```\n\n```js\nconst a = "中";\n```\n',
      '```js title="a"\nconst a = 1;\n```\n\n````js\nconst a = 1;\n````\n\n~~~js\nconst a = 1;\n~~~\n\n``` js\nconst a = 1;\n```\n\n```js\nconst a = 1;\n``` \n',
      "```js\r\nconst a = 1;\r\n```\r\n",
      // Many that aren't, then some that are.
      "```js\nconst  a=1\n```\n\n".repeat(30) + "```js\nconst a = 1;\n```\n\n".repeat(30),
      // HTML: below the root it is read like a file, but for what is no code in a text with a parent.
      ...[
        '<div class="a b">\n  <p>c</p>\n</div>',
        '<div   class="a  b "><p>c</p></div>',
        '<p style="color: red">a</p>\n<p style="color: red;">b</p>\n<p style="color:red">c</p>\n<p style=" color : red ; ">d</p>',
        '<div>\n  <p style="color: red;width: 1px;">a</p>\n  <p style="\n    color: red;\n  ">a</p>\n  <p style="color: red; width: 1px">a</p>\n</div>',
        '<img srcset="a.png 1x, b.png 2x" sizes="(min-width: 1px) 2px, 3px" />\n<iframe allow="a; b"></iframe>\n<a onclick="b( )">c</a>',
        "<pre>\n  a\n    b\n</pre>\n<textarea>\n c\n</textarea>",
        "<!-- a\n   b -->\n<p>c</p>",
        '<p\n  title="a\n  b"\n>\n  c\n</p>',
        "<script>\n  const  a = `\n  b`\n</script>\n<style>\n  a{color:red}\n</style>",
        "<script>\n  const a = 1;\n</script>\n<style>\n  a {\n    color: red;\n  }\n</style>",
        "<!DOCTYPE html>\n<html>\n  <head>\n    <title>a</title>\n  </head>\n  <body>\n    <p>b</p>\n  </body>\n</html>",
        "<!doctype html>\n<p>a</p>",
        "---\na: 1\n---\n\n<p>b</p>",
        `<p>${"word ".repeat(30)}</p>`,
        "<ul>\n  <li>a</li>\n  <li><b>c</b> d</li>\n</ul>\n\n\n<p>e</p>",
        "<p>a",
        '<p>{{ a }}</p>\n<p :b="c+d"></p>',
      ].flatMap(code => [
        `\`\`\`html\n${code}\n\`\`\`\n`,
        `a\n\n\`\`\`html\n${code}\n\`\`\`\n\nb\n`,
        `- a\n\n  \`\`\`html\n${indented(code, "  ")}\n  \`\`\`\n`,
        `> \`\`\`html\n${code.replace(/^/gm, "> ")}\n> \`\`\`\n`,
        `\`\`\`vue\n${code}\n\`\`\`\n`,
      ]),
    ];
    describe("Markdown", () => expectSame("a.md", texts, options));
    describe("MDX", () =>
      expectSame(
        "a.mdx",
        [
          ...texts,
          "import  a from 'a'\nimport {b} from \"b\"\n\nexport const c = 1\n\nexport default  d\n\n# e\n",
          "import a from 'a'\nconst b = 1\n\nexport const c = 1\nd()\n\nexport * from 'e'\n\nexport {f}\n\nexport {g} from 'g'\n",
          "export const a = `\n  b\n`\n\nexport const c = {\n  d: 1 }\n\nexport function e() { return <f/> }\n\n- g\n\n  export const h = `\n    i\n  `\n",
          "import a from 'a' // b\n\n// c\nimport d from 'd'\n\nexport const e = ;\n\nimport\n\nexport\n\n'use strict'\nimport f from 'f'\n",
          // JSX below the root, and in a list.
          "<A b={1}  c='d' />\n\n<A b={{c:1}}>\n  e\n</A>\n\n<A>\n  <B c={d}/>\n  <E />\n</A>\n\n<A>{b}{c}</A>\n\n<A>\n  {b ? <C /> : null}\n</A>\n",
          `<A b={${"c".repeat(80)}} />\n\n<A b="${"c".repeat(40)}" d="${"e".repeat(40)}" />\n\n<A b={() => { f() }} />\n\n<A {...b} />\n\n<A b={\`c\nd\`} />\n`,
          "<A />\n<B />\n\n<A>b</A> c\n\n<A>b</A>;\n\n<A b={1: 2} />\n\n<A>{/* c */}</A>\n\n<A>{b /* c */}</A>\n\n<A b={c // d\n} />\n\n<></>\n\n<>a <b>c</b></>\n",
          "- a\n\n  <A b={1}  c='d'>\n    <B />\n    e   f\n  </A>\n\n> <A b={`c\n> d`} />\n\n<A b={css`a{color:red}`} />\n\n<A b={{ 1: c, 'd': e }} />\n",
          '<A>\n  text   {b}   more <C>d</C>\n  {\' \'}\n  e\n</A>\n\n<A>&nbsp;&amp;</A>\n\n<A b="&quot;" c=\'"\' />\n\n<a.b.c d />\n\n<a:b c:d="e" />\n\n<$ />\n\n<A></$>\n',
        ],
        options,
      ));
  });
});

describe("TypeScript that the long way rejects", () => {
  /** Nothing is printed, with or without the short cuts, and the messages are the same. */
  function expectRejected(name: string, texts: string[]) {
    test.skipIf(!hasFlag).concurrent(name, async () => {
      const { different, said, expected } = await differences(name, texts, []);
      expect(different).toEqual([]);
      expect(said).toEqual(expected);
      expect(texts.filter((_, index) => !String(said[0]).includes(` ${index}/${name}:`))).toEqual([]);
    });
  }
  expectRejected("a.ts", [
    // parentheses that end the body of an arrow function before the `:` of a conditional expression, and what can be read as a type before a `{` or a `=>`
    "2?():X=>({}):()=>class{}",
    "a?()=>(b):()=>class{}",
    "a?()=>(b):c|class{}",
    "a?()=>(b):typeof class{}",
    "a?()=>(b):void{}",
    "a?()=>(b):c\n{}",
    "a?x=>()=>(b):()=>c\n{}",
    "a?c=()=>(b):class{}",
    "a?c?d:()=>(b):class{}",
    "a?()=>(b):()=>{if(x){y}{z}}",
    // parentheses as the body of an arrow function before the `:` of a conditional expression and a class
    "a?()=>(b):class{}",
    "2?():X=>({}):class{}",
    // a call of `async` without arguments, or with a spread first, before the `:` of a conditional expression
    "a?async():b",
    "a?async(...x):b",
    "a?c=async():b",
    // `?` behind the type of `as`, before what starts no type
    "b as e?(class{}):d",
    "(b)()as e?(class{}):()=>l",
    "b satisfies e?(class{}):()=>l",
    "b as e?-c:d",
    "b as e?(-c):d",
    // await, a block comment and what is no word, in a namespace
    'module a{await/**/{""(){}}}',
    // a test of a case that ends with parentheses where an arrow function could stand
    "switch($){case()=>(a):{if(b){c}}}",
    "switch($){case a=(b):{if(b){c}}}",
    "switch($){case a?b:(c):{if(b){c}}}",
    "switch($){case a,(b):{if(b){c}}}",
    "switch($){case async(b):{if(b){c}}}",
    "function*f(){switch($){case yield(b):{if(b){c}}}}",
    // `in` behind the value of a field, in the head of a for
    "for(e=class{e=n\nin};;){}",
    // a word behind yield and a block comment
    "a=yield/**/as s",
    "a=yield/**/satisfies s",
    // what starts with the name await on the left of `**`
    "await.a**x",
    // `case (a): {`, which TypeScript tries as the head of an arrow function
    "switch($){case(a):{if(b){c}}}",
    "switch($){case(a):{switch(b){case 1:}}}",
    // a conditional type in the parameters or type parameters of a function type, where there can be no conditional type
    "type a=b extends(s:p extends o?a:a)=>d?r:n",
    "type a=b extends new(s:p extends o?a:a)=>d?r:n",
    "let a:a extends(infer o extends(s:p extends/**/o?a:a)=>d)?r:n",
    "type a=b extends<T extends p extends o?a:a>()=>d?r:n",
    "type a=b extends<T=p extends o?a:a>()=>d?r:n",
    // modifiers of class members
    "class A { public private a }",
    "class A { public public a() {} }",
    "class A { static static a }",
    "class A { readonly a() {} }",
    "class A { declare a() {} }",
    "class A { declare get a() {} }",
    "class A { accessor a() {} }",
    "class A { accessor get a() {} }",
    "class A { readonly get a() {} }",
    "class A { async get a() {} }",
    "class A { declare async a() }",
    "class A {\n  readonly a(): void {}\n}\n",
    "class A {\n  declare a(): void;\n}\n",
    "class A {\n  public private a: T;\n}\n",
    // abstract members
    "abstract class A { abstract a() {} }",
    "abstract class A { abstract a = 1 }",
    "abstract class A { abstract get a() {} }",
    "abstract class A { abstract a!: T }",
    "abstract class A { abstract constructor() }",
    "abstract class A {\n  abstract a(): void {}\n}\n",
    "abstract class A {\n  x: T;\n  abstract a = 1;\n  y: T;\n}\n",
    "abstract class A {\n  abstract get a(): T {\n    return 1;\n  }\n}\n",
    "abstract class A {\n  abstract a!: T;\n}\n",
    // two members on a line, words that are no modifiers
    "class A { a b }",
    "class A { 1 2 }",
    "class A { a = 1 b }",
    "class A { a: b c }",
    "class A { if a }",
    "class A { let a }",
    "class A { as a }",
    "class A { a\n  b c }",
    "class A { [a] b }",
    "class A { #a b }",
    "class A { static @a b }",
    "class A { a @b c }",
    "class A { a: b() }",
    // constructors
    "class A { constructor }",
    "class A { constructor; }",
    "class A { constructor: T }",
    "class A { constructor = 1 }",
    "class A { constructor?() {} }",
    "class A { 'constructor' }",
    "class A { 'constructor': T }",
    "class A { static constructor }",
    "class A { async constructor() {} }",
    "class A { readonly constructor() {} }",
    "class A { declare constructor() }",
    "class A { static async constructor() {} }",
    "class A { @a constructor() {} }",
    "class A { 'constructor'<T>(public a) {} }",
    "class A {\n  constructor;\n}\n",
    "class A {\n  constructor: T;\n  a: T;\n}\n",
    "class A {\n  async constructor() {\n    a;\n  }\n}\n",
    "class A {\n  @a constructor() {\n    a;\n  }\n}\n",
    // index signatures
    "class A { public [a: string]: T }",
    "class A { declare [a: string]: T }",
    "class A { abstract [a: string]: T }",
    "class A { @a [b: string]: T }",
    "class A { *[a: string]: T }",
    "class A { [public a: string]: T }",
    "interface A { static [a: string]: T }",
    "interface A { public [a: string]: T }",
    "let a: { [public b: c]: d }",
    // members of interfaces and type literals
    "interface A { public a }",
    "interface A { static a: T }",
    "interface A { abstract a(): T }",
    "interface A { declare a }",
    "interface A { async a(): T }",
    "interface A { override a }",
    "interface A { accessor a }",
    "interface A { readonly a(): T }",
    "interface A { export a }",
    "type A = { declare a }",
    "type A = { private a: T }",
    "interface A { a: T = 1 }",
    "interface A { get a: T }",
    "interface A { set a }",
    "interface A { get a?(): T }",
    "interface A { a b }",
    "interface A {\n  accessor\n  get a(b): T\n}",
    "interface A { get a(): T {}; }",
    "interface A {\n  in\n  get a()\n}\n",
    "interface A {\n  out\n  get a()\n}\n",
    "type A = {\n  const\n  set a(b)\n}\n",
    "interface A {\n  public a: T;\n}\n",
    "interface A {\n  readonly a(): T;\n}\n",
    "interface A {\n  x: T;\n  static a: T;\n}\n",
    // parameter properties
    "function f(public a) {}",
    "function f(readonly a) {}",
    "function f(override a) {}",
    "class A { m(public a) {} }",
    "class A { constructor(public a); }",
    "declare class A { constructor(public a); }",
    "class A { constructor(public ...a) {} }",
    "class A { constructor(public {a}) {} }",
    "class A { constructor(readonly []) {} }",
    "class A { constructor(public private a) {} }",
    "interface A { m(public a) }",
    "interface A { (public a) }",
    "interface A { new (public a) }",
    "type A = (public a) => void",
    "type A = new (public a) => void",
    "x = { m(public a) {} }",
    "x = function (public a) {}",
    "class A { constructor(a = function (public b) {}) {} }",
    "class A {\n  constructor(public a: T);\n}\n",
    "class A {\n  m(public a: T) {\n    b;\n  }\n}\n",
    // the parameter `this`
    "function f(this?: T) {}",
    "function f(this = 1) {}",
    "function f(this: T = 1) {}",
    "function f(...this) {}",
    "function f(public this) {}",
    "function f(@a this) {}",
    "type A = (this?: T) => U",
    "type A = (...this: T) => U",
    "x;\ntype A = (this?: T) => U;\ny;\n",
    "class A {\n  m(this?: T): void;\n}\n",
    // decorators
    "function f(@a b) {}",
    "x = function (@a b) {}",
    "x = { m(@a b) {} }",
    "x = class { m(@a b) {} }",
    "x = class { constructor(@a b) {} }",
    "class A { m(@a b); }",
    "class A { get a(@b c) {} }",
    "interface A { m(@a b) }",
    "declare function f(@a b)",
    "declare class A { m(@a b); }",
    "class A { @a m(); }",
    "class A { @a get b(); }",
    "abstract class A { @a abstract m(); }",
    "x = class { @a abstract b }",
    "@a => b class A {}",
    "@<T>a class A {}",
    "@a<b>.c class A {}",
    "@a interface A {}",
    "@a enum A {}",
    "@a type A = 1",
    "@a declare function f();",
    "class A {\n  @a m(): void;\n}\n",
    "class A {\n  @a()\n  m(): void;\n}\n",
    "abstract class A {\n  @a abstract m(): void;\n}\n",
    // empty lists of types
    "a<>()",
    "a<>",
    "new a<>",
    "new a<>()",
    "a?.<>()",
    "a<>``",
    "let a: b<>",
    "let a: typeof b<>",
    "class A<> {}",
    "class A extends B<> {}",
    "class A implements B<> {}",
    "interface A<> {}",
    "interface A extends B<> {}",
    "type A<> = 1",
    "function f<>() {}",
    "x = function <>() {}",
    "x = <>() => {}",
    "x = { m<>() {} }",
    "class A { m<>() {} }",
    "interface A { m<>() }",
    "interface A { <>() }",
    "type A = <>() => void",
    "type A = new <>() => void",
    "x;\nlet a: b<>;\ny;\n",
    "class A {\n  a: b<>;\n}\n",
    "class A {\n  m<>(): void {}\n}\n",
    // modifiers of type parameters
    "function f<in T>() {}",
    "function f<out T>() {}",
    "x = <in T>() => 1",
    "class A { m<in T>() {} }",
    "type A = <out T>() => void",
    "class A<public T> {}",
    "class A<static T> {}",
    "class A<readonly T> {}",
    "class A<static extends B> {}",
    "class A<out extends B> {}",
    "type A<out\nT> = T",
    "type A<in\nT> = T",
    "interface A<abstract T> {}",
    // heritage
    "class A implements 1 {}",
    "class A implements B() {}",
    "class A implements (B) {}",
    "class A implements B?.C {}",
    "class A implements B[0] {}",
    "class A implements B! {}",
    "class A implements {} {}",
    "class A implements this {}",
    "class A implements B.#c {}",
    "class A implements implements {}",
    "class A extends implements {}",
    "class A extends <T>B {}",
    "class A extends {} ! {}",
    "class A extends {} <T> {}",
    "interface A extends 1 {}",
    "interface A extends B() {}",
    "interface A extends (B) {}",
    "interface A extends B['C'] {}",
    "interface A extends typeof B {}",
    "interface A extends {} {}",
    "interface A extends implements {}",
    "interface A extends B?.C {}",
    "class A implements implements {\n  a: T;\n}\n",
    // enums
    "enum A { 1 }",
    "enum A { 1 = 1 }",
    "enum A { 1n }",
    "enum A { [a] }",
    "enum A { ['a'] }",
    "enum A { [`a`] }",
    "enum A { `a` }",
    "enum A { [a] = 1 }",
    "enum A {\n  1 = 1,\n}\n",
    "const enum A { ['a'] = 1 }",
    "declare enum A { 1 }",
    // namespaces
    "namespace A",
    "namespace A;",
    "module A",
    "module A;",
    "declare namespace A;",
    "declare module A;",
    "{ namespace A }",
    // what stands behind `declare`
    "declare function f() {}",
    "declare function f(): T {}",
    "declare function* f();",
    "declare async function f();",
    "a;\nexport declare function f() {}",
    "declare var a = 1",
    "declare let a = 1",
    "declare const a: T = 1",
    "declare var [a] = b",
    "declare let a!: T",
    "declare using a = b",
    "declare type\nA = 1",
    "declare class {}",
    "declare abstract class {}",
    "export declare class {}",
    "x;\ndeclare function f(): void {}\ny;\n",
    "x;\ndeclare var a = 1;\ny;\n",
    // functions without a body
    "function* f();",
    "function* f(): T;",
    "export function* f();",
    "async function* f();",
    // classes without a name
    "abstract class {}",
    "export abstract class {}",
    "@a abstract class {}",
    // statements that start with a modifier
    "static\nvar a",
    "static class A {}",
    "public class A {}",
    "private instanceof a",
    "public as a",
    "readonly in a",
    "accessor as a",
    "protected satisfies a",
    "x;\npublic as a;\ny;\n",
    // definite assignment
    "let a!",
    "let a! = 1",
    "let a!: T = 1",
    "const a!: T",
    "using a!: T = b",
    "let [a]!: T",
    "let {a}!: T",
    "for (let a!: T;;);",
    "for (let a!: T of b);",
    "class A { a! }",
    "class A { a! = 1 }",
    "class A { a!: T = 1 }",
    "class A { a?!: T }",
    "class A { accessor a! }",
    "x;\nlet a!: T = 1;\ny;\n",
    "class A {\n  a!: T = 1;\n}\n",
    "class A {\n  a?!: T;\n}\n",
    // types
    "let a: keyof",
    "let a: unique",
    "let a: readonly",
    "let a: infer",
    "let a: b | () => c",
    "let a: | () => b",
    "let a: b & () => c",
    "let a: b | new () => c",
    "let a: b.#c",
    "let a: b<if>",
    "let a: [if]",
    "let a: b[if]",
    "let a: import('b', c)",
    "let a: import('b',)",
    "let a: { [b in c]: d, }",
    "let a: { [b in c]: d; e: f }",
    "let a: { [if in b]: c }",
    "type A = intrinsic | 1",
    "type A = intrinsic[]",
    "let a: ?() => b",
    "x;\nlet a: b | (() => c) | () => d;\ny;\n",
    // a line break behind a dot
    "x = a.\nb in c",
    "a.\nb instanceof c",
    "a?.\nb in c",
    "@a.\nb class A {}",
    "@a.\n#b class A {}",
    "class A { @a.\nb #a }",
    "let x: a.\nb extends c ? 1 : 2",
    // what is assigned to
    "a as b = 1",
    "a satisfies b = 1",
    "<b>a = 1",
    "<T>(a) = 1",
    "({} as {} = a)",
    "if (function () {} = a) {}",
    "#a = 1",
    // type arguments behind an expression
    "a<b>.c",
    "a<b>?.c",
    "a?.b<c>.d",
    "new a<b>.c",
    "a << b >> (c)",
    "a<<b>>(c)",
    "a < (b, c) > (d)",
    "a < (b = c) > (d)",
    "1 <T,> >>> 2",
    "new <T>a",
    "new <T>a()",
    "<T>a => b",
    "<1>(a) => 1",
    "async (a?)",
    "async (a: b)",
    "async (a?: b)",
    "a < keyof > (c)",
    "a < keyof, b > (c)",
    "a < [infer] > (c)",
    "a < [,] > (c)",
    "a < typeof [] > (c)",
    "a < new {} > (c)",
    "a < < {} > (c)",
    "a < import(b) > (c)",
    "<T>a++ ()",
    "<T>a.b++ !",
    "x = async <T>(a) : T",
    "a<{b: c(d)}>`e`",
    "f<{a: b>({c: 'd'})}(e => {})",
    "x = a as const < b",
    "type A = typeof B<<T>(a) => U>",
    // `as` between operators
    "x = 1 + 1 as number * 2",
    "x = 1 + 1 as any as number * 2",
    "x = 1 >> 1 as number + 2",
    "x = 1 + 1 satisfies number * 2",
    // a type assertion where only a left-hand side expression can stand
    "++<T>a",
    "--<T>a.b",
    // parentheses before a block
    "(a)\n{}",
    "x = (a)\n{}",
    "x = (a, b)\n{}",
    "x = ({a})\n{}",
    "async (a)\n{}",
    "if (x) (a)\n{}",
    // a line break that TypeScript does not see, or sees
    "function f(): asserts a\nis",
    "class A {\n  a(): asserts b\n  is\n}\n",
    "export * from 'b'\nwith { a: 'b' }",
    "export {a} from 'b'\nwith { a: 'b' }",
    "a < b & new c > (d)",
    // `enum`, `await` and `yield` as names in TypeScript's own places
    "let a: [enum]",
    "let a: B<enum>",
    "let a: B[enum]",
    "let a: B<enum[]>",
    "type A = [enum, b];\n",
    "class A {\n  a: B<C, enum>;\n}\n",
    "let a: (enum: T) => void",
    "interface A {\n  a: (enum: T) => void;\n}\n",
    "function f(): enum is T {}",
    "let a: asserts enum",
    "let a: { [enum in T]: U }",
    "import enum = b",
    "import type enum = require('m')",
    "import { type enum } from 'm'",
    "import { type a as enum } from 'm'",
    "import { type as enum } from 'm'",
    "import { type as as if } from 'm'",
    "export {}; type await = 1",
    "type await = 1; export {}",
    "export {}; interface await {}",
    "export {}; enum await {}",
    "export {}; namespace await {}",
    "export {}; function f<await>() {}",
    "function* g() { f<yield>(a) }",
    "function* g() {\n  f<yield>(a);\n}\n",
    "async function g() { f<await>(a) }",
    "class A { m(@a(await) b) {} }",
    "class A { *m(@yield b) {} }",
    "async function f() { import await = b.c }",
    "import.meta; await",
    "x = import.meta.url;\nawait;\n",
    "type A = [if: T];\nawait",
    // the head of a `for`
    "for (var a = 1 in b);",
    "for (let a = 1 of b);",
    "for (var a, b of c);",
    "for (var a, b in c);",
    "for (var a: T of b);",
    "for (var a: T in b);",
    "for (let in a);",
    "for (let of a);",
    "for (let = 1;;);",
    "for (let.a in b);",
    "for (using a;;);",
    "for (1 of a);",
    "for (this of a);",
    "for (a + b of c);",
    "for (a, b of c);",
    "for (({a}) of b);",
    "for (([a]) of b);",
    "for (this in a);",
    "for (new a in b);",
    "for (a = [b in c];;);",
    "for (var a = [b in c];;);",
    "for (var a = (b = c in d) => {};;);",
    "for (var a = function (b = c in d) {};;);",
    "for (var a = 1 in b) {\n  c;\n}\n",
    // imports and exports
    "import a = require()",
    "import a = require(b)",
    "import a = require(`b`)",
    "import a = require('b', 'c')",
    "import a = require('b',)",
    "import type a = b",
    "import type a = b.c",
    "export import type a = b",
    "import a = if",
    "import a = b.if",
    "import a = b.#c",
    "import type a, {b} from 'c'",
    "import type a, * as b from 'c'",
    "import source a from 'b'",
    "import module a from 'b'",
    "import type defer * as a from 'b'",
    "import.source('a')",
    "import {type default} from 'a'",
    "import {type if} from 'a'",
    "import {type a as if} from 'b'",
    "import {type 'a'} from 'b'",
    "export {type default}",
    "export {type if}",
    "export {type 'a'}",
    "export {type if};\nx;\n",
    "export type as = 1",
    "export default declare class A {}",
    "export default interface",
    "export default type A = 1",
    "export default namespace A {}",
  ]);
  expectRejected("a.tsx", [
    // type arguments that TypeScript mends, and that end together with a list in them
    "o<keyof|d<y>>(1)",
    "o<keyof|d<e<y>>>(1)",
    // nothing goes on behind an element
    "<a />.b",
    "<a />()",
    "<a />[b]",
    "<a />`b`",
    "<a />!",
    "<a />?.b",
    "<a></a>.b",
    "<></>.a",
    "x = <a />.b",
    "f(<a />.b)",
    "<a /><T>",
    "<a /> < b",
    // `</` is one token
    "<a>< /a>",
    "<>< />",
    "<a></* c */b /></a>",
    "<></* c *//>",
    "x = <// c\na />",
    "interface A<// c\nT> {}",
    "let a: B<// c\nT>",
    "x = a <// c\nb",
    // what looks like type parameters
    "<const x={} />",
    "x = <const a='b' />",
    "const x = <const a='b' />;\n",
    "<T,>a</T>",
    "<T extends U>a</T>",
    "<a<> />",
  ]);
  expectRejected("a.ts", [
    // an arrow function as a decorator
    "@async () => 1 class A {}\n",
    "class A { @async () => 1 m() {} }\n",
    // `constructor` with an escape
    'class A { "\\u0063onstructor" = 1 }\n',
    'class A {\n  "constructo\\x72": T;\n}\n',
    // type arguments that TypeScript's parser mends
    "x = a<keyof<b>>(c);\n",
    "x = a<readonly<b>>(c);\n",
    "x = a<unique<b>>(c);\n",
    "x = a<b<keyof<d>>>(e);\n",
    "f(a < import(b), 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, c > (d));\n",
    "x = a?.b<T>`c`;\n",
    // `await` and a line break in the value of a field, in an object on several lines
    "class A {\n  a = {\n    e: await\n a,\n  };\n}\n",
    "class h{e(){}\na={\ne:await \na}}\n",
    // a modifier and a name: a parameter, an index signature
    "(out satisfies T)\n",
    "(static satisfies T)\n",
    "x = (declare satisfies T);\n",
    "type A = { [declare as a]: T }\n",
    "interface A { [static as a]: T }\n",
    "class A { [abstract as a]: T }\n",
    // parentheses before the `:` of a conditional expression, and a word before a `{`
    "x = a ? b ? (c0) : class {} : z;\n",
    "x = a ? b ? (c, d) : void {} : z;\n",
    "x = a ? b ? x = ({ c }) : delete {} : z;\n",
    "function* g() { x = a ? yield (b) : class {}; }\n",
    "switch (x) { case <T>(b, c): void {}; }\n",
    // characters that are letters since Unicode 16
    "x = \u088fa;\n",
    "x = \u1c89;\n",
    "x = a\u0897;\n",
    "x = a\u1acf;\n",
    "class A { #\ua7cb; }\n",
    "x = { a\ud803\udd4a: 1 };\n",
  ]);
  expectRejected("a.tsx", [
    // a comment directly behind the `<` of type arguments in a tag
    "x = <a><Component<// c\nnumber> foo></Component></a>;\n",
    // characters that are letters since Unicode 16
    "x = <a\u0897 />;\n",
  ]);
  describe("what looks like it and is printed", () =>
    expectSame(
      "a.ts",
      [
        "interface A {\n  x: T;\n  new();\n  new(): T;\n  y: T;\n}\n",
        "x;\na < keyof \nb > (c);\ny;\n",
        "x;\nconst a = b < c\nd > (e);\n",
        "x = a < (b + c) && a > (d);\n",
        "x = a < !b;\n",
        "if (a < (b = c)) {\n}\n",
        "x = a < b!.c ? d : e;\n",
        "class A extends (B) {}\n",
        "type A = (| typeof b)[number];\n",
        "export interface ScrollResponderEvent extends NativeSyntheticEvent<& NativeTouchEvent> {}\n",
        "[{...a as T}!] = x;\n",
        "({ a: <T>{...a as T} } = x);\n",
        "<T>class A { m() { @a class B {} } };\n",
        "x = a as const\n< b;\n",
        "x = (aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.b < cccccccccccccccccccccccc()) > dddddddddddddddddddddddd[0];\n",
        "import a from 'b'\nwith { a: 'b' }\n",
        "interface A {\n  in: T;\n  out: T;\n  const: T;\n}\n",
      ],
      [[]],
    ));
});

describe("what the quick way for scripts is asked about, and what is done around it", () => {
  const scripts = [
    "const f = <T,>(x: T) => x;\n",
    "a  ;\n",
    "",
    " \n\t\n",
    "\n\n",
    "﻿",
    "﻿\n",
    "﻿a  ;\n",
    "﻿#!/usr/bin/env bun\na  ;\n",
    "#!/usr/bin/env bun\n\n\na  ;",
    "a  ;",
    "// only a comment",
    "/** @format */\na  ;\n",
    "/** @noformat */\na  ;\n",
    "// @flow\nlet a  = 1;\n",
    "await  (x);\n",
  ];
  const names = ["a.js", "a.jsx", "a.mjs", "a.cjs", "a.ts", "a.tsx", "a.mts", "a.cts", "a.d.ts", "A.TS", "a.js.flow"];
  describe.each(names)("%s", name =>
    expectSame(name, scripts, [
      [],
      ["--no-insert-final-newline"],
      ["--insert-pragma"],
      ["--require-pragma"],
      ["--check-ignore-pragma"],
      ["--range-start=1"],
      ["--range-end=3"],
      ["--experimental-ternaries"],
      ["--tab-width=0"],
      ["--tab-width=20000"],
      ["--print-width=0"],
      ["--print-width=4000000000"],
    ]),
  );

  // The first "\r" decides, whatever ends the lines before it.
  describe("the end of a line", () =>
    expectSame(
      "a.ts",
      [
        "a;\nb;\r\nc;\r",
        "a;\r\nb;\n",
        "a;\rb;\n",
        "a;\n\rb;",
        "x = `a\r\nb\rc\n`;\n",
        "/* a\r\nb */\r\nc;\n",
        "a;\r",
        "\r\n",
        "\r",
      ],
      [
        ["--end-of-line=auto"],
        ["--end-of-line=lf"],
        ["--end-of-line=crlf"],
        ["--end-of-line=cr"],
        ["--end-of-line=cr", "--no-insert-final-newline"],
      ],
    ));

  describe("Flow", () =>
    expectSame(
      "a.js",
      [
        "// @flow\ntype A = {| a: 1 |};\n",
        "/* @noflow */\nfunction f(a: number) {}\n",
        "// @flow\nfunction f(a /*: number */) {}\n",
        "// @flow\n/*:: type A = 1; */\n",
        "// @flow\n/* flow-include type A = 1; */\n",
        "#!/usr/bin/env node\n// @flow\ntype A = ?B;\n",
        "a;\n// @flow\ntype A = ?B;\n",
      ],
      [[]],
    ));
});

describe.skipIf(!hasFlag)("scripts that are printed unlike Prettier prints them, or that are odd", () => {
  // One row for each class of input: the name of the file, the flags, the text.
  const rows: [name: string, flags: string, text: string][] = [
    // The only parameter before a return type in which an object type doesn't fit (prettier#19968).
    [
      "a.ts",
      "",
      "function f(a: string): B<{ aaaaaaaaaaaaaaa: number, bbbbbbbbbbbbbbbb: number, cccccccccccccccccc: number }> {}\nclass A {\n  method(this: A): Promise<[C, { aaaaaaaaaaaaaaa: number, bbbbbbbbbbbbbbbb: number, ccccccccccccccc: number }]> {}\n  abstract m({ a, b }: A): a is B & { aaaaaaaaaaaaaaa: number, bbbbbbbbbbbbbbbb: number, ccccccccccccccccc: number };\n}\ninterface I {\n  m(a: string): B<{ [K in keyof Taaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa]: Tbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb[K] }>;\n  new (a: string): B<{ aaaaaaaaaaaaaaa: number, bbbbbbbbbbbbbbbb: number, cccccccccccccccccc: number, d: 1 }>;\n}\ntype F = (a: string) => B<{ aaaaaaaaaaaaaaa: number, bbbbbbbbbbbbbbbb: number, cccccccccccccccccc: number, d: 1 }>;\nfunction g(a = { b: 1 }): B<{ aaaaaaaaaaaaaaa: number, bbbbbbbbbbbbbbbb: number, cccccccccccccccccc: number }> {}\nfunction h(a: string): B<{ a: (b: string) => C<{ aaaaaaaaaaaaaaa: number, bbbbbbbbbbbbbbbb: number, ccccccc: 1 }> }> {}\n",
    ],
    [
      "a.ts",
      "--object-wrap=collapse",
      "function f(a: string): B<{ aaaaaaaaaaaaaaa: number, bbbbbbbbbbbbbbbb: number, cccccccccccccccccc: number }> {}\n",
    ],
    [
      "a.js.flow",
      "",
      "function f(a: string): B<{ aaaaaaaaaaaaaaa: number, bbbbbbbbbbbbbbbb: number, cccccccccccccccccc: number }> {}\ndeclare function f(a: string): B<{| aaaaaaaaaaaaaaa: number, bbbbbbbbbbbbbbbb: number, ccccccccccccccc: number |}>;\n",
    ],
    // White space that isn't a blank, a tab or a line break: at the end of a comment that stands alone on its line, ..
    ["a.ts", "", "first();\n// c\u00a0\ni;\n"],
    ["a.ts", "", "first();\n/**\n * e\u3000\n */\ni;\n"],
    ["a.ts", "", "first(); // c\u00a0\ni;\n"],
    // .. between tokens, ..
    ["a.ts", "", "a(/* c */\ufeff/* c */ b);\n"],
    ["a.ts", "", "function f() /* c */\u3000{}\n"],
    ["a.js", "", "x1\f;\n\ny();\n"],
    ["a.js", "", "foo = {\n  a\u00a0,\n\n  b,\n};\n"],
    // .. on a line that is empty but for it.
    ["a.js", "", "a = {\n  b: [],\n\u000b\n  d,\n};\n"],
    // U+2028 and U+2029 are line breaks in some places.
    ["a.ts", "", "var\u2028x;\n"],
    ["a.tsx", "", "x = <a>\u2029</a>;\n"],
    ["a.ts", "", "first();\nglobal\u2028{}\n"],
    // What TypeScript's parser takes for a modifier, and drops, is a statement or a member of its own for another parser.
    ["a.ts", "", "declare export = x;\n"],
    ["a.ts", "", "declare import a = b;\n"],
    ["a.ts", "", "class A {\n  export c;\n}\n"],
    ["a.ts", "", "class A {\n  const a;\n}\n"],
    ["a.ts", "", "class A {\n  default function() {}\n}\n"],
    // A `;` that doesn't directly follow what it ends, or ends nothing: the empty lines around it, ..
    [
      "a.ts",
      "",
      "class A {\n  b = 1;\n\n;  /** a comment that is printed after the property */\n  d(e?: string) {}\n}\n",
    ],
    ["a.ts", "", "class C {\n  x() {}\n  ;\n\n  static;\n}\n"],
    ["a.js", "", "for (a of b);\n;\n\na();\n"],
    ["a.js", "", "a: ;\n;\n\na;\n"],
    // .. and the comments behind it, which count for the width of the line before.
    [
      "a.ts",
      "",
      "class A {\n  someProperty: SomeType<WithArguments> = new SomeType<WithArguments>();\n; /** a comment that is printed after the property */\n}\n",
    ],
    [
      "a.ts",
      "",
      "class A {\n  @a() b: string;\n; /** a comment that is printed after the property, and makes its line too wide */\n}\n",
    ],
    ["a.ts", "", "type T = {\n  a: string // c\n; /* d */\n}\n"],
    ["a.js", "", "a // b\n;/* c *//* c */\n"],
    // The guard of code without semicolons is none of these.
    ["a.js", "--no-semi", "const a = 1\n;[1, 2].forEach(f)\n\n;(function () {})()\nfunction g() {}\n;`t`.length\n"],
    // A `,` that starts a line, and an empty line behind it.
    ["a.js", "", "({\n  a\n  ,\n\n  b,\n});\n"],
    ["a.js", "", "const {\n  A\n  ,\n\n  B,\n} = c;\n"],
    ["a.js", "", "foo = {a\n\n  ,\n  b: 'b'};\n"],
    ["a.js.flow", "", "type A = {|\n  a: number\n  ,\n\n  b: boolean,\n|};\n"],
    // A member expression as a computed key is no plain text: what follows it is measured anew.
    [
      "a.ts",
      "--tab-width=64",
      "export const rate = {\n  a() {\n    return {\n      [user.id]: user,\n    };\n  },\n};\n",
    ],
    // Some trees have a node around an optional chain, so that its last member is no direct child of the assignment.
    ["a.ts", "--print-width=8", "aaaa!?.cccc = vvvv;\n"],
    ["a.ts", "--print-width=8", "aaaa()?.cccc = vvvv;\n"],
    ["a.tsx", "--print-width=8", "aaaa!?.cccc! = vvvv;\n"],
    ["a.js.flow", "--print-width=8", "aaaa?.cccc[0] = vvvv;\n"],
    ["a.ts", "--print-width=8", "aaaa()?.cccc! = vvvv;\n"],
    // The width of sequences: a modifier behind what is no base for it, flags, keycaps, tags, joiners, the replacement character.
    [
      "a.js",
      "--print-width=11",
      'f("\u234d\ud83c\udfff", b);\nf("\ud83d\udc4d\ud83c\udfff", b);\nf("\ud83c\uddef\ud83c\uddf5", b);\nf("\ud83c\uddefa", b);\nf("1\ufe0f\u20e3", b);\nf("\ud83c\udff4\udb40\udc67\udb40\udc62\udb40\udc65\udb40\udc6e\udb40\udc67\udb40\udc7f", b);\nf("\ud83d\udc69\u200d\ud83d\udc67", b);\nf("\ufffda", b);\nf("\u00a9\ufe0f", b);\nf("\u263a", b);\nf("\u263a\ufe0f", b);\n',
    ],
    // A cell of a table of `each` that is printed on several lines.
    ["a.js", "", 'it.each`\n  a | b\n  ${{\n    c: 1,\n  }} | ${2}\n`("x", () => {});\n'],
    // An empty line in a tuple type.
    ["a.ts", "", "type T = [\n  a,\n\n  b,\n];\n"],
    // A statement that starts with the name `let`.
    ["a.js", "--no-semi", "let;\n"],
    // A decorator on the line of `export`.
    ["a.ts", "", "@t(1)export class A{}\n"],
    // What looks like type arguments ends no line.
    ["a.ts", "--print-width=30", "aaaaaaaaaaaa > bbbbbbbbbbbb < cccccccccccc > dd;\n"],
    ["a.ts", "--print-width=30", "(aaaaaaaaaaaaaaaaaaa < cccccccccccc) > ddddddd;\n"],
    ["a.ts", "--tab-width=8 --print-width=30", '8n>{}</i1cript" a-b />te\n'],
    // A type assertion around what breaks.
    ["a.ts", "", "x = <T>class {\n  m() {\n    enum b {\n      c = 1,\n    }\n  }\n};\n"],
    ["a.ts", "", "x = <a>function () {\n  @x class a {}\n};\n"],
    // A member chain in the parameters of a function that is the last argument.
    ["a.ts", "--print-width=28", "d=d((y=a.b().c())=>{})\n"],
    ["a.js", "--print-width=28", "new d((a=d.e().a())=>{})\n"],
    // `declare type` is no `type`: its function type keeps the parentheses of the only parameter.
    ["a.js.flow", "--arrow-parens=avoid", "declare type A = (B) => C;\n"],
    // A union as the key of an indexer that breaks.
    [
      "a.js.flow",
      "--print-width=22",
      'const filteredSections: {\n  ["apis" | "components"]: Array<SectionData<RNTesterModuleInfo>>,\n} = {};\n',
    ],
    // A comment that starts where another one ends.
    ["a.js", "", "/**\n * a\n *//**\n * b\n */\n"],
    // A comment next to an optional chain.
    ["a.ts", "", "if (sockets[name]?.length === // c\n0) delete sockets[name];\n"],
    ["a.ts", "", "const code\n// c\n= (error as { code?: string } | null)?.code;\n"],
    ["a.tsx", "", 'a = typeof option === "object" && !! // c\n(option as Segmented)?.icon;\n'],
    // A comment in a `declare type`.
    ["a.js.flow", "", "declare type A = // c\n// d\nB | C;\n"],
    // A comment before the separator of the member that it follows.
    ["a.js.flow", "", "declare class A {\n  a: () => void\n// c\n;\n\n  b: number;\n}\n"],
    // A comment behind the last property of a pattern that has a type.
    ["a.js.flow", "", "const A = ({\n  a,\n/* c */}: {\n  a: string,\n}) => `x`;\n"],
    // A comment in the empty braces of an object type.
    ["a.js.flow", "", "function f(props: {\n// c\n}): R {}\n"],
    // A comment between the key of a method and its parameters, or on the line of their `(`.
    ["a.ts", "", "class A {\n  override visit\n// c\n(sourceFile: B) {}\n}\n"],
    ["a.ts", "", "a = {\n  fn( // c\nargs) {},\n};\n"],
    // A comment before the `:` of a type.
    [
      "a.js.flow",
      "",
      "export default function useWindowDimensions() // c\n:\n  | DisplayMetrics\n  | DisplayMetricsAndroid {}\n",
    ],
    // A comment between the name of a function and its parameters.
    [
      "a.js.flow",
      "",
      "export default function useWindowDimensions // c\n():\n  | DisplayMetrics\n  | DisplayMetricsAndroid {}\n",
    ],
    // A comment in a member expression whose object is no call.
    ["a.js", "", 'a = {\n  parser: require\n// c\n.resolve("hermes-eslint"),\n};\n'],
    // A block comment with a line break in it and code on its lines.
    [
      "a.mjs",
      "--use-tabs --tab-width=4",
      "const getCertdataURL = version => {\n  const certdataURL /* c\n c */= `https://hg.mozilla.org/projects/nss/raw-file/${tag}/lib/ckfw/builtins/certdata.txt`;\n};\n",
    ],
    // A comment before the `...` of a rest parameter of a function type.
    ["a.js.flow", "", "declare var console: {\n  error: (\n// c\n...data: $ReadOnlyArray<mixed>) => void,\n};\n"],
    // Comments in places where real code has none.
    ["a.ts", "", "function f(): Element[/* c\n c */] | null {}\n"],
    ["a.ts", "", 'describe("x", () /* a */ /* b */=> {\n  f();\n});\n'],
    ["a.jsx", "", "a = <T><b>Log<\n// c\n/b>: {m}</T>;\n"],
    ["a.ts", "", "a = {\n  [b]:\n// c\n(value: number) => isNumber(value),\n};\n"],
    // The name `let` in parentheses.
    ["a.js", "--no-semi", "(let)\n"],
    // A `;` behind a comment, with nothing to end.
    ["a.js", "", '/* @flow */;\nimport "a";\na();\n'],
    // A declaration as the body of an `if`.
    ["a.ts", "", "if (1)\n  const enum A {}\n"],
    // `await` that is a name among the parameters, for TypeScript.
    ["a.tsx", "", "class A { set a(@dec {a} = await {}) {} }\n"],
    // `new ()` in an interface is no method with the name `new`.
    ["a.ts", "", "interface foo{\n bar():any\n new()\n}\n"],
    // `{ " " }` is white space like `{" "}`.
    [
      "a.jsx",
      "",
      'x = <A>\n  <code>one two three four</code> a b;{" "}\n  { " " }\n  <code>a</code>{" "} a{" "}\n\t</A>\n',
    ],
    // A comment between two words of the head of a declaration or a member.
    ["a.ts", "", "class A {\n  static // c\n  readonly a = 1;\n}\n"],
    ["a.js", "", "class A{static// why\n  accessor x1}\n"],
    ["a.js", "", 'import a// b\n/**\n */from"d"\n'],
    ["a.ts", "", "export default class// b\nimplements A{}\n"],
    // A comment that is all there is between the parentheses of a method.
    ["a.js", "", "class C{#f(/* b */){}static{}}\n"],
    // A comment behind the value of a class property.
    ["a.js", "", "class A {\n  #x = (0 /* a */);\n}\n"],
    // What may be a type cast of JSDoc, in Flow and in a conditional expression.
    ["a.js.flow", "", "/** @type {A} */(l)\n"],
    ["a.js", "", "a?/** @type {any} */(b?1:2):3\n"],
    // Flow: a comment before or behind the parameters of a method of an object type.
    ["a.js.flow", "", "declare class M{static/* 1 */():void}\n"],
    ["a.js.flow", "", "type AndroidPlatform={get Version():/* @__PURE__ */{||}}\n"],
    // Flow: a type guard as the return type of an arrow function.
    ["a.js.flow", "", "a=():x is{a:()=>void}=>true\n"],
    // Flow: a `declare module` with nothing in it.
    ["a.js.flow", "", 'declare module"a"{}\n'],
    // A conditional as a branch of a conditional where a level of indentation is one column.
    ["a.js", "--print-width=25 --tab-width=1", "const price = user ? (user.isMember ? 8 : 10) : 12;\n"],
    // A statement that is an `as` expression: some names get parentheses.
    ["a.ts", "", "component as T;\nhook satisfies T;\n"],
    // `prettier-ignore` in plain places: on lines of its own before a statement, a member, a property.
    [
      "a.ts",
      "",
      "// a\n// prettier-ignore\nconst a   =  [1,0,\n              0,1];\nb  (  );\n/* prettier-ignore */\ndeclare module   'vue' {\n  interface   A {}\n}\nclass C {\n  // prettier-ignore\n  m( a,b ) { }\n  n( a,b ) { }\n}\ninterface I {\n  // prettier-ignore\n  a:   1;\n  b:   2;\n}\nx = {\n  // prettier-ignore\n  'a':   1,\n  'b':   2,\n};\n",
    ],
    [
      "a.ts",
      "--no-semi",
      "a()\n// prettier-ignore\nb  (  )\nfunction f() {\n  c();\n  // prettier-ignore\n  return   d\n}\n",
    ],
    // `prettier-ignore` in other places.
    [
      "a.ts",
      "",
      "function f(value: unknown) {\n  for\n// prettier-ignore\n(let i = 0; i < value.length; ++i) {\n    g(i);\n  }\n}\n",
    ],
    // Before a member of an object type of Flow, whose separator is no part of it.
    [
      "a.js.flow",
      "",
      "export interface Spec {\n  // prettier-ignore\n  +getConstants: () => {||};\n  +getBase64ForTag: () => void;\n}\n",
    ],
    // Before a `declare export` of Flow.
    ["a.js.flow", "--no-semi", "x;\n// prettier-ignore\ndeclare export function f(): void;\n"],
    // White space of any kind before the words.
    ["a.js", "", "a;\n//\u00a0prettier-ignore\nb  (  );\n/*\u3000prettier-ignore */\nc  (  );\n"],
    // What is taken: holes in an array that is broken.
    [
      "a.ts",
      "",
      'const [\n  ,\n  name,\n  writtenDirection,\n  writtenByteCount,\n  writtenKind,\n  writtenEndianness,\n  writtenSomethingElse,\n] = match;\nx = [\n  ,\n  ,\n\n  __create(base?.[__knownSymbol("metadata")] ?? null, aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa),\n];\n',
    ],
    // What is taken: comments among the arguments of an optional call, before an optional chain, behind a parameter, a `:` or a `.`.
    [
      "a.js",
      "",
      'legacyRef.current?.measureLayout(\n  // c\n  containerRef.current,\n  (x, y) => {},\n);\na =\n  flattenStyle(prevProps.style)?.opacity !==\n  // c\n  flattenStyle(this.props.style)?.opacity;\nclass A {\n  m(\n    onSuccess,\n    onFail /* currently unused */,\n  ) {}\n}\nb = {\n  data:\n    // c\n    // d\n    options ? options.data : null,\n};\nc = factory./* c */ $call(iterable);\nd =\n  e === "android"\n    ? /* c\n       * d */\n      (f) => g\n    : h;\n',
    ],
    [
      "a.js.flow",
      "",
      "export interface Spec {\n  +getParentNode: (shadowNode: mixed /* ShadowNode */) => mixed /* ?InstanceHandle */;\n  +getChildNodes: () => void;\n}\n",
    ],
    // Flow: a comment among the parameters of a static method of a declared class.
    [
      "a.js.flow",
      "",
      "declare class A {\n  static createNext<U>(/* c */value: U): B<U>;\n  static createComplete(/* c */): B<any>;\n}\n",
    ],
    // Flow: JSX that breaks gets no parentheses as the body of a case of `match`.
    [
      "a.js.flow",
      "",
      "const getIcon = (type: 'confirm' | 'error') =>\n  match (type) {\n    'confirm' =>\n      <ListenLaterAddedSVG\n        color=\"var(--color-core-confirm)\"\n        size=\"large\"\n        {...iconProps}\n      />,\n  3 => (\n    <div>\n    </div>\n  ),\n};\n",
    ],
    // What the reader copies stands for a group: the next group is not measured anew because of a line break before it.
    [
      "a.jsx",
      "",
      'a = (\n<>\n<b>\n  ccccccc\n  <d>e</d>\n</b>\n<Divider orientation="left">sub-element xxxxxxxxxxxxxxxxxx center</Divider> <Row>\n</Row>\n</>\n);\n',
    ],
    // The parameters of a function in a wrapper, in a test call with a long name.
    [
      "a.js",
      "",
      'it("does something really long and complicated so I have to write a very long name for the test", fakeAsync((b) => {\n  code();\n}));\n',
    ],
    // Flow: a function type as the value of an indexer or a spread.
    [
      "a.js.flow",
      "--arrow-parens=avoid",
      "type A = { [key: string]: (void) => { ... }, ... };\ntype B = { ...(boolean) => void };\n",
    ],
    // Flow: one parameter, and an object type behind a `?` as the return type.
    [
      "a.js.flow",
      "--print-width=60",
      "interface Spec {\n  +getObjectShape: (arg: ?{| prop: ?number |}) => ?{| prop: ?number |};\n}\n",
    ],
    // Where the long way is not Prettier's way: a private name as the tag of a template.
    ["a.js", "", "class A { #y; m() { styled.#y`\n` } }\n"],
    // A member with the name `export` in a class of Flow.
    ["a.js.flow", "", "class A{export\n  constructor(){}}\n"],
    // `<>` as type arguments in Flow.
    ["a.js.flow", "--print-width=20", "class A { _transforms: $ReadOnlyArray<Transform<>>; }\n"],
    ["a.js.flow", "", "[].reduce(()=>{[]},([]:Arraystring<>))\n"],
    // Import attributes on several lines.
    ["a.js", "--object-wrap=collapse", 'import a3 from "foo" with {\n  BABEL_8_BREAKING: "false", };\n'],
    // A test call with `?.` in its callee.
    [
      "a.js",
      "",
      'test?.skip("does something really long and complicated so I have to write a very long name for the test",()=>{})\n',
    ],
    // Flow: `boolean | null` and the like, where they do not fit.
    ["a.js.flow", "--print-width=20", "type A = { prefersFuseboxFrontend: boolean | null };\n"],
    [
      "a.js.flow",
      "--print-width=20",
      "class A {\n  extraData: mixed | void;\n  get oldValue(): mixed | null {}\n}\nfunction f(command: () => Promise<mixed | void>) {}\n",
    ],
    // White space beyond ASCII in the text of an element.
    ["a.jsx", "", "<fbt><fbt:param>\u00a0\n    </fbt:param><fbt:param></fbt:param></fbt>\n"],
    // A comment before an object that is the right side of a logical expression.
    ["a.js", "--print-width=30", "ErrorLike=SerializedProps&&\n  // short\n  {causeunknown}\n"],
    // A comment between the name of a type and its type arguments.
    ["a.js.flow", "", "type A =\n  | CDPRequest<'a'>\n  | CDPRequest\n// c\n<>\n"],
    // A comment next to the `=` of an attribute, or between `/` and `>`.
    [
      "a.jsx",
      "",
      "const IndicatorStyle = () => {\n  return (\n    <View>\n      <View>\n        <Button\n          onPress//c\n={() =>\n            indicatorStyle === 'default'\n              ? setIndicatorStyle('white')\n              : setIndicatorStyle('default')\n          }\n          label={'Indicator Style: ' + indicatorStyle}\n        />\n      </View>\n    </View>\n  )\n}\n",
    ],
    [
      "a.js",
      "",
      "// @flow\nconst RemoveClippedSubviews = () => {\n  const [removeClippedSubviews, setRemoveClippedSubviews] = useState(false)\n  return (\n    <View>\n      <ScrollView\n        style={[styles.scrollView, {height: 200}]}\n        removeClippedSubviews={removeClippedSubviews}\n        nestedScrollEnabled>\n        {ITEMS.map(createItemRow)}\n      </ScrollView>\n      <Button\n        label={'removeClippedSubviews: ' + removeClippedSubviews.toString()}\n        onPress={() => setRemoveClippedSubviews(!removeClippedSubviews)}\n      / /* cc */ >\n    </View>\n  )\n}\n",
    ],
    // Comments behind a word of an export, before the body of a function, behind a member without a separator, in a qualified name.
    ["a.ts", "", 'export/**/*as a from""\n'],
    ["a.ts", "", "export//\n\n@x class a{}\n"],
    ["a.ts", "", 'function a()//\n{""}\n'],
    ["a.ts", "", "interface a{T/**@type*/\n\nT}\n"],
    ["a.js.flow", "", "interface a extends b//\n.c<>{y:T}\n"],
    // Flow: a `;` that starts a line between two members.
    ["a.js.flow", "", "interface a{x:T\n;\n\ny:T}\n"],
    // prettier-ignore before a statement in a statement that gets a semicolon.
    ["a.ts", "", "function f() {\n  // prettier-ignore\n  for (;;) break\n  l: var x  = 1\n}\n"],
    ["a.js", "", "for (;;) {\n  // prettier-ignore\n  while (a) continue\n  // prettier-ignore\n  l: debugger\n}\n"],
    // A comment before the `in` or the `of` of a loop.
    ["a.ts", "", "for(c//\nin``)z\n"],
    ["a.ts", "", "for(c//\nof``){z()}\n"],
    // .. or behind it, before a template.
    ["a.ts", "", "for(c in//\n``)z\n"],
    ["a.ts", "", "for(c of//\n`a${b}`){z()}\n"],
    // A comment before the `{` of a class is printed on the line of the first member, whose lines stand as they are written.
    ["a.ts", "", "class A\n/**/{\n  m() {\n    r(async () => {\n      a = x;\n    });\n  }}\n"],
    ["a.ts", "", "class A\n\n/* c */ {\n  a = async () => {\n    const a = !x;\n  };\n}\n"],
    ["a.ts", "", "class A<T> extends B<T> implements C\n/**/{\n  m(): s {\n    b;\n  }}\n"],
    // `<const>x`, which the long way never breaks.
    ["a.ts", "--print-width=12", "a=<const>x\n"],
    // A union that a conditional type among type arguments checks, where it breaks.
    ["a.ts", "--print-width=16", "const a:b<X|Y extends c?d:e>=z\n"],
    ["a.ts", "--print-width=7", "type a=X|Y extends Y?Z:X\n"],
    ["a.ts", "--print-width=7", "type a=x|{\nT}&x extends y?z:x\n"],
    ["a.ts", "--print-width=4", "type a={\nT}|x extends y?Z:x\n"],
    // Flow: `<*>`, which the long way does not break.
    ["a.js.flow", "--print-width=18", "async function a():e<*>{z()}\n"],
    // Flow: the name `bool` or a qualified name behind `implements` or `extends`.
    ["a.js.flow", "", "class a implements bool{}\n"],
    ["a.js.flow", "", "interface a extends bool{}\n"],
    ["a.js.flow", "--print-width=24", "class a implements a.b{}\n"],
    // Flow: a function type with one type as its parameters, where it does not fit.
    ["a.js.flow", "--print-width=20", "class a{static b:X=>Y}\n"],
    ["a.js.flow", "--print-width=34", 'declare module""{declare module.exports:X=>Y}\n'],
    ["a.js.flow", "--print-width=24", "declare export default X=>Y\n"],
    ["a.js.flow", "--arrow-parens=avoid", "class a{static b:X=>Y;c:X=>Y}\ndeclare class d{static b:X=>Y;c:X=>Y}\n"],
    [
      "a.js.flow",
      "--arrow-parens=avoid",
      'declare module""{declare module.exports:X=>Y}\ndeclare export default X=>Y\n',
    ],
    ["a.js.flow", "--arrow-parens=avoid", "type A={[string]:X=>Y,...X=>Y,[[a]]:X=>Y,b:X=>Y}\n"],
    ["a.js.flow", "--print-width=30", "class A {\n  _a: {\n    [string]: (boolean) => void,\n  } = {};\n}\n"],
    // Flow: `a < b > c`, which the long way may take for type arguments.
    ["a.js", "", "//@flow\nc<[...X]>(y)\n"],
    // Flow: `interface {}` as the only type argument, where it does not fit.
    ["a.js.flow", "--print-width=27", "c=b<interface{a:X}>()\n"],
    // Flow: a negative number in a tuple type, whose sign the long way drops.
    ["a.js.flow", "", "const a:[-1]=z\n"],
    ["a.js.flow", "", "type a=[X,-1]\n"],
    // Flow: a type cast as the initial value in a `for`-`in`.
    ["a.js.flow", "", "for(var a=(x:Y)in b);\n"],
    // Flow: `|` at the start of the supertype of an opaque type, `interface {}` in an intersection.
    ["a.js.flow", "", "opaque type a:|X\n"],
    ["a.js.flow", "", "type a=interface{}&Y\n"],
    // Flow: the supertype of an opaque type in parentheses.
    ["a.js.flow", "", "opaque type a:(|X)\n"],
    // A chain of calls as a computed key: only the variant on one line says whether the key can break.
    ["a.ts", "--print-width=17", "({[x.d().h()]:``})\n"],
    ["a.ts", "--print-width=17", "({[x.d().h()]:1})\n"],
    ["a.ts", "--print-width=10", "e,{[a(()=>{},x)]:``}\n"],
    ["a.ts", "--print-width=13", "h,{[d(()=>{},x)]:class{}}\n"],
    // A line break in a text is one that counts.
    ["a.ts", "--print-width=6", "({[`\n`]:``})\n"],
    ["a.ts", "--print-width=3", "h,{[(`\n`)]:0}\n"],
    ["a.ts", "--print-width=6", '({["\\\n"]:``})\n'],
    // The value of an `accessor` is indented like that of no other property.
    ["a.ts", "--print-width=9", "class a{private accessor b=x&y}\n"],
    ["a.js", "--print-width=9", "class a{accessor b=x+y;static accessor c=x&&y}\n"],
    // A namespace has directives.
    ["a.ts", "", "namespace N{'\\''}\n"],
    ["a.ts", "", "module\"\"{'\\'';'a';b;'c'}\n"],
    ["a.ts", "", "declare namespace N{'a'\n\n// c\nb}\n"],
    ["a.ts", "", "namespace N{('a');'b'}\n"],
    // A pattern with a type and an arrow function, the object type of an only parameter with decorators, computed keys.
    ["a.ts", "--print-width=17", "const[]:a<x>=y=>x\n"],
    ["a.js.flow", "--print-width=17", "const[]:e<e>=e=>a\n"],
    ["a.ts", "--print-width=14", "class a{d(@h h:{x}){}}\n"],
    ["a.ts", "--print-width=9", '({["\t"]:l})\n'],
    ["a.ts", "--print-width=8", "({[ 1 ]:l,[.5]:l})\n"],
    // An optional call in parentheses at the head of a chain is a call for Babel's tree only.
    ["a.ts", "--print-width=17", "(a?.()).i.d().l()\n"],
    ["a.js", "--print-width=17", "(a?.()).i.d().l()\n"],
    ["a.js.flow", "--print-width=17", "(a?.()).i.d().l()\n"],
    ["a.ts", "", "(o?.().c().d((``,2)));\n(l?.().c().e(((()=>{}))));\nnew(a.b?.()().d([()=>f]));\n"],
    ["a.ts", "--print-width=28", "(a?.().e().r((c>{})))\n"],
    [
      "a.ts",
      "--print-width=17",
      "((d?.()).l).h().i();\n(a?.())!.i.d().l();\n(a?.())().i.d().l();\n(a?.b()).i.d().l();\n",
    ],
    // A comment that names a language, where the long way does not see it.
    ["a.ts", "", "({[/* GraphQL */`{a}`]:y})\n"],
    ["a.ts", "", "d&&(/* GraphQL */`{d}`&&h)\n"],
    ["a.ts", "", "d||(/* HTML */`<a></a>`||h)\n"],
    // `await` and `yield` are names in the members of an enum, whatever function is around it, ..
    ["a.ts", "", "async()=>{enum a{a=await(x)}}\n"],
    ["a.ts", "", "async()=>{enum a{a=await x,b=await,c=(await``)[0]}}\n"],
    ["a.ts", "", "function*f(){enum a{a=yield(x),b=yield*x}}\n"],
    ["a.ts", "", "async()=>{enum a{a=await(x)}await(x)}\n"],
    // .. and what they are among parameters is a matter of the function that has the parameters.
    ["a.ts", "", "async()=>{class a{b({a=await({})}){}}}\n"],
    ["a.ts", "", "async()=>{({b(a=await({})){}})}\n"],
    ["a.ts", "", "async()=>{(a=await({}))=>{}}\n"],
    ["a.ts", "", "async()=>{(a=await(x)):T=>{}}\n"],
    ["a.ts", "", "function*f(){class a{b(a=yield(1)){}}}\n"],
    ["a.ts", "", "(e=await/e/i)=>{}\n"],
    ["a.ts", "", "(e=(await(k())``))=>{}\n"],
    ["a.ts", "", "async()=>{type a=(a=await(x))=>b}\n"],
    ["a.ts", "", "async()=>{interface a{b(a=await(x))}}\n"],
    ["a.js", "", "async()=>{class a{b(@(await(x))c){}}}\n"],
    // What is no part of a name, in a name of JSX.
    ["a.js", "", "<a\u0085/>\n"],
    ["a.js", "", "<a><\u0085b/></a>\n"],
    ["a.js", "", '<a b=""\u0085/>\n'],
    ["a.js", "", "<a\u200b/>\n"],
    ["a.js", "", "<a\u2014/>\n"],
    ["a.js", "--print-width=9", '<a><b></b>{" "}\u0085</a>\n'],
    // An import whose first name is longer than the line.
    ["a.js", "--print-width=10", 'import lphahaAlpha,{b}from""\n'],
    // A list on lines of its own in a list on lines of its own that fits on one line.
    ["a.js", "--print-width=14 --tab-width=4", "a=[\n[\na(\nb,\na\n)\n]\n]\n"],
    [
      "a.ts",
      "--print-width=71 --tab-width=16",
      "(a=>{for(const{}of[]){\n                                return [\na(\noBravo,\nha(),\nCharli\n)\n]\n}})\n",
    ],
    // A call that hugs a function, in the default value of a parameter of a function that is hugged.
    ["a.ts", "--print-width=12", "a(({o={c:a(()=>[g()])}})=>{})\n"],
    ["a.ts", "--print-width=12", 'a(({e:{o=a(()=>b?"":c)}})=>{})\n'],
    ["a.ts", "--print-width=20", "a((o=a(()=>[g()]))=>{})\n"],
    // A comment before an optional chain, around which some trees have a node more; in a call of one that has no arguments.
    ["a.ts", "--print-width=16", "o\n//\n=[()=>(class{}).e]?.()\n"],
    ["a.ts", "--print-width=13", "a=\n//\na?.((function(){c()}))\n"],
    ["a.ts", "", "(\n//\na?.a)()\n"],
    ["a.ts", "", "({a:\n//\na?.b})\n"],
    ["a.ts", "", "({a:\n//\na?.b!})\n"],
    ["a.ts", "", "`${\n//\na?.()}`\n"],
    ["a.tsx", "", "<a b={\n//\na?.()}/>\n"],
    ["a.ts", "", "new(\n//\na?.b)\n"],
    ["a.ts", "", "class A extends(\n//\na?.b){}\n"],
    ["a.ts", "--print-width=26", "class a extends n?.(/**/){r(a,b){}}\n"],
    // An element of JSX as a decorator, a key, what a class extends, what is spread or waited for, or in a parameter that is hugged.
    ["a.tsx", "--print-width=4", "@(<a/>)class a{}\n"],
    ["a.js", "--print-width=10", "a=class{@(<a>{/ /}</a>)a}\n"],
    ["a.tsx", "--print-width=18", "const{[<></>]:a}\n"],
    ["a.tsx", "--print-width=26", '({[<a>{""}</a>](){}})\n'],
    ["a.js", "--print-width=17", "class a extends(/**/<a/>){}\n"],
    ["a.tsx", "", '<a b=""{.../**/<a/>}/>\n'],
    ["a.js", "--print-width=18", "(`${await(await(<a>f</a>)).a}`)\n"],
    ["a.js", "--print-width=29", "a(({a:{b=<a>o</a>.p}})=>{})\n"],
    // A class as a decorator or a key.
    ["a.tsx", "", "class e{@(@n class extends function(){}{})a(){}}\n"],
    ["a.tsx", "--print-width=10 --tab-width=8", "({[(class{})]:(g)})\n"],
    // `a && (b && c)` is `(a && b) && c`: an array, an object or an element that comes to stand on the right.
    ["a.js", "--print-width=13", "a&&([[]]&&(e)&&n)\n"],
    ["a.js", "--print-width=15", "a&&(({1:1})&&([])&&2)\n"],
    ["a.js", "--print-width=23", "a||((<a/>)||(<a/>).a||(a))\n"],
    // An index signature without a parameter.
    ["a.ts", "--print-width=5", "type b={[]}\n"],
    ["a.ts", "--print-width=4", "a<{[]:k}>\n"],
    // Import attributes on lines of their own, where the import is the body of a statement.
    ["a.ts", "--print-width=36", 'if(a)import""with{\ntype:""}\n'],
    ["a.js", "--print-width=41", 'for(;;[])import""with{\ntype:""}\n'],
    // A function with a return type as the argument of the call of a call.
    ["a.tsx", "--print-width=34", 'const e=e()(():[{}&{""}]=>{})\n'],
    ["a.ts", "--print-width=30", "const e=e()(():[aaaaa,bbbbbb]=>{})\n"],
    // A line comment next to a `=`, or before a template.
    ["a.ts", "--print-width=6", "const{l//\n=``}\n"],
    ["a.ts", "", "const[a//\n=``]\n"],
    ["a.ts", "", "enum a{e//\n=``}\n"],
    ["a.ts", "--print-width=2", 'enum a{a//\n="".h}\n'],
    ["a.ts", "--print-width=2", 'enum a{""=//\n5..a}\n'],
    ["a.ts", "--print-width=7", "const a:{t://\n``}\n"],
    ["a.ts", "--print-width=15", "function e([]=//\n[]):`aaaaaaaaaaaaaa`\n"],
    ["a.ts", "--print-width=13", "const[{}]//\n=()=>a?d:b\n"],
    ["a.js", "--print-width=6", "const{a:l,c,l}=//\n(``())\n"],
    ["a.ts", "--print-width=14", "for(d of//\n()=>a?1:b);\n"],
    ["a.js", "--print-width=11", "for(const{}of//\n(``)){}\n"],
    // A block comment with a line break in it, while other comments wait for the end of the line.
    ["a.ts", "", 'o//\n=""/*\n*/\n'],
    ["a.tsx", "", "({}=(e//\n))/*\n*/\n"],
    ["a.ts", "", 'import""with{\n/**/}/*\n*/\n'],
    ["a.ts", "--print-width=5", "a<{y://\n/*\n*/g}>\n"],
    // Comments: before the `=` of a type alias, between `[` and `]` of an array type, before the `|` of what is asserted, in the parentheses of an element of a tuple, in a decorator, on both sides of a `.`, before type arguments.
    ["a.tsx", "--print-width=34", "type d<e extends{a:(new()=>t)[]}>/**/={[h as n]:l}\n"],
    ["a.ts", "--print-width=32", "const d:(()=>x)[\n//\n]=5\n"],
    ["a.tsx", "--print-width=5", "function d():h is\n//\n|/**/c|t\n"],
    ["a.ts", "--print-width=18", 'b(a as([(""\n//\n\n),a<[]>]))\n'],
    ["a.ts", "", "type a=[g,(//\na)]\n"],
    ["a.ts", "--print-width=16", "(@e()\n/**/.e class{})\n"],
    ["a.js", "--print-width=7", "e()//\n./**/b\n"],
    ["a.js", "", "//@flow\nd/**/<|l>()\n"],
    // A template literal type with braces in it.
    ["a.tsx", "--print-width=21", "function a(a):b is(l)=>`${y<{bT}>}b`{((d))}\n"],
    ["a.tsx", "--print-width=23", "function a({a:{}}):(`a${ise<{e:T}>}b`)|(h)\n"],
    ["a.ts", "--print-width=24", "const a:((c)=>([`${{o}[]}`extends[]?t:r]))\n"],
    // A decorator of a parameter of a function that is no method.
    ["a.js", "", "function a(@a(()=>(t),()=>[])o){}\n"],
    ["a.js", "", '//@flow\nfunction a<a>(@a(b=>(""),()=>function(){})a){}\n'],
    // A type assertion with a type that breaks, as the first of a sequence.
    ["a.ts", "", "return<{\na}>a,(k)\n"],
    // Flow: three names with dots where a type is extended or opaque, `a.b<>` where one is extended, ..
    ["a.js", "", "//@flow\ninterface a extends b.b.b<>{a:h}\n"],
    ["a.js", "--print-width=12", "//@flow\ninterface a extends b.b<>{}\n"],
    ["a.js", "", "//@flow\ndeclare class a extends b.b.b<>{}\n"],
    ["a.js", "--print-width=21", "//@flow\nopaque type a=a.o.r\n"],
    ["a.js", "--print-width=23", "//@flow\n(c=>{opaque type e:o.b.t<{e:T}>=e})\n"],
    // .. what only flow-parser reads, where Babel goes on with a comparison, `asserts` at the end of a line, ..
    ["a.js", "", "//@flow\n[[]]<keyof\nf>((class{}))\n"],
    ["a.js", "", "//@flow\na?b?a<a<keyof(1)>>((a)):c:d\n"],
    ["a.js", "", "//@flow\nlet a:()=>asserts\ne\n"],
    // .. `<*>` on the left of a `=`, a function type as the type of `this`.
    ["a.js", "--print-width=18", "//@flow\nconst a:e<*>=``\n"],
    ["a.js", "", "//@flow\ntype a=(this:(?b)=>v)=>v\n"],
    // What the long way prints as Prettier does by now: the type of `this`, a name that is short in characters, a pattern with a default value on the left of a `=`, an operator in the key of a pattern.
    ["a.ts", "", "(this:{\nT})=>d\n"],
    ["a.ts", "", "interface a{(this:{\nT}):d}\n"],
    ["a.ts", "--print-width=31", "const d:(this:{T})=>void|null\n"],
    ["a.js", "", "//@flow\ntype a=(this:{\na:{g:T}})=>e\n"],
    ["a.js", "--print-width=11 --tab-width=1", "\u00e9.\u6587().\uff45()\n"],
    ["a.ts", "--print-width=9", "e\u0301.\u00e9().c()\n"],
    ["a.ts", "", "({a:{a:[]}=(k).b}=a&{a(){f()}})\n"],
    ["a.js", "--print-width=5", "const{[a&b]:a}\n"],
    ["a.js", "--print-width=9", "try{(a)}catch({[h+o]:a}){(a)}\n"],
    ["a.ts", "--print-width=6", "({[a|l]:a},a={a(){}})=>e\n"],
    // A sequence in a function in a sequence in a function, and so on.
    [
      "a.ts",
      "",
      "f(() => (a, f(() => (a, f(() => (a, f(() => (a, f(() => (a, f(() => (a, f(() => (a, f(() => (a, f(() => (a, f(() => (a, f(() => (a, f(() => (a, f(() => (a, f(() => (a, f(() => (a, f(() => (a, f(() => (a, f(() => (a, f(() => (a, f(() => (a, x))))))))))))))))))))))))))))))))))))))))\n",
    ],
    // `#a in b` where `in` is no operator, `<<` behind a name that is extended.
    ["a.js", "", "class A{#a;m(){for(var a=#a in b);}}\n"],
    ["a.ts", "", "interface a<X>extends b<<X>()=>Y>,c{}\n"],
    // `using` at the top of what is no module, in a host that indents it.
    ["a.html", "", "<script>using a = b</script>\n"],
    ["a.html", "", "<script>await using a=(r)</script>\n"],
    ["a.html", "", "<script>for(var a=#a in b);</script>\n"],
    // Something that is ignored and has an empty line in it, in a code block that is indented.
    ["a.md", "", "-\n  ```ts\n  (c=>{if([a?2:2])e\n  //prettier-ignore\n  a=\n\n  e})\n  ```\n"],
    // A type assertion with a type that breaks.
    ["a.ts", "--print-width=10", "(<{\nT}>e)=[1,3]\n"],
    // An element of JSX as an argument, in a parameter that is hugged.
    ["a.jsx", "--print-width=31", "a(({a=a(<a>a</a>)},[])=>{''})\n"],
    // A comment on a line of its own before what is asserted.
    ["a.tsx", "--print-width=5", "function d():h is\n//\nd|/**/t\n"],
    // Flow: an object type as the only parameter, without a name.
    ["a.js.flow", "", "type A={a:X}=>Y\n"],
    // Flow: a function type with `?A` among its parameters, as a parameter without a name.
    ["a.js.flow", "", "type A=((?X)=>Y)=>B\n"],
    ["a.js.flow", "", "type A=((a:?X)=>Y,Z)=>B\n"],
    // Flow: a cast of something that starts with parentheses, `<*>` deeper in a type on the left of a `=`.
    ["a.js", "", "//@flow\na=(//\n(a())((()=>{d()})()):s<c>)\n"],
    ["a.js", "", "//@flow\na=((a:c))\n"],
    ["a.js", "--print-width=20", "//@flow\nconst a:b<*>[]=class{}\n"],
    // A blank has been written when the comments that wait for the end of the line are.
    ["a.ts", "--print-width=15", "(()=>a+(a//\n)as``)\n"],
    ["a.tsx", "--print-width=13", "function d//\n([]:j):[]|l\n"],
    ["a.ts", "", "(a as//\nX)=``\n"],
    // `await`, the end of the line, `using`.
    ["a.cts", "", "{await\nusing a=f}\n"],
    ["a.ts", "", "(function(){await/**/\nusing a=x})\n"],
    // An optional chain in parentheses that goes on.
    ["a.ts", "--print-width=5", "(a?.e.e)?.()\n"],
    ["a.tsx", "--print-width=7", 'a=(a?.e().D((<a r=""/>)).a).a\n'],
    // A comment that names a language before a template literal type.
    ["a.tsx", "", "type a=((keyof/* GraphQL */(`${o}`)))\n"],
    // `{...a}` between tags with a blank behind it.
    ["a.js", "", '<>{""}{...t(()=>{g},[])} <b></b></>\n'],
    // Comments: between a callee and its arguments on the left of a `=` or in a key, around the `?` or the `]` of the key of a method, behind an optional chain, before a cast of JSDoc with an object in it or without semicolons, in or behind the braces of an import, ..
    ["a.ts", "--print-width=9", "a\n/**/().b=``\n"],
    ["a.ts", "--print-width=9", "({[a\n/**/()]:``})\n"],
    ["a.ts", "--print-width=10", "class a{a?\n/**/():Y{z()}}\n"],
    ["a.ts", "", "[{s(){}},{[this]\n//\n(){}}]\n"],
    ["a.ts", "", "({[((c/**/))\n/**/](){}})\n"],
    ["a.ts", "", "`${(e?.()\n/**/)}`\n"],
    ["a.js", "--print-width=16", "{/**@type*/({}())}\n"],
    ["a.js", "--print-width=12 --no-semi", '/**@type*/(await"")\n'],
    ["a.ts", "", '{import d,{//\n}/**/ /**/from""}\n'],
    // .. behind a `=` before a function whose first parameter is `this`, behind a decorator on the line of what it decorates, a line comment and a block comment over lines among arguments, in a chain before `satisfies`, in and behind the parentheses of a `switch`.
    ["a.ts", "", "const p=//\nfunction(this:l){}\n"],
    ["a.ts", "", "const p=//\ntypeof function(this:l){}\n"],
    ["a.js", "", '(/ /),class{@("")\n/**/#a=(``)}\n'],
    ["a.js", "--print-width=9", 'skip("",//\n/*\n*/()=>{})\n'],
    ["a.tsx", "", 'class e{*e(){yield e("")\n//\n.o satisfies[]}}\n'],
    ["a.ts", "", "switch(a()//\n)/**/ /**/{/**/}\n"],
    // `new await`.
    ["a.ts", "", "const a=new await\n"],
    ["a.md", "", "```ts\nconst a=new await\n```\n"],
    // A comment of JSDoc on a line of its own before parentheses with an object in them, a comment in the parentheses of the type of the elements of an array.
    ["a.js", "--print-width=15", "\n/**@type*/({}())\n"],
    ["a.js", "--print-width=13", "{/**@type*/\n({}.a=[])}\n"],
    ["a.ts", "", "(a as((e)//\n//\n)[])=class{a():()=>d}\n"],
    // What the quick way refuses and a line is written for without a document: the head of a `case` before a block that is ignored, a statement behind a block comment and a `;`.
    [
      "a.mjs",
      "--print-width=40 --tab-width=7",
      'switch(a){case(()=>f):{import""with{t:""}}//prettier-ignore\n;case c:}\n',
    ],
    ["a.jsx", "--print-width=10 --tab-width=5 --no-semi", "{/*\nd*/;e2|n}\n"],
    // A member that does not fit, behind a line comment: the line break of the comment and its own.
    ["a.js", "--print-width=2", "a()//\n.b\n"],
    ["a.js", "--print-width=11", "a()//\n.bbbbbbbbbb\n"],
    ["a.ts", "--print-width=3", "const{a=x,b,c}=//\nx.#a\n"],
    ["a.ts", "--print-width=1", "const a:b<X,Y extends c?d:e>=//\nt.e.n\n"],
    ["a.ts", "--print-width=3", "(`${a()//\n.b}`)\n"],
    ["a.js", "--print-width=7", "e()//\n.t/**/\n"],
    // Comments: behind a `=` before what starts with a function whose first parameter is `this`, before the body of an arrow function, at the start of what is yielded.
    ["a.ts", "", "const a=//\nfunction(this:X){}satisfies Y\n"],
    ["a.ts", "--print-width=6", '(c)=>//\n{""}\n'],
    ["a.ts", "", "<X>()=>//\n{''}\n"],
    ["a.ts", "", "function*a(){b=yield(\n/**/\nx)|b}\n"],
    ["a.ts", "", "function*a(){yield a()\n/**/\n.b}\n"],
    ["a.ts", "", "function*a(){yield(/**/\nx?a:b)?c:d}\n"],
    ["a.ts", "", "function*a(){yield(\n/**/\nx as Y)()}\n"],
    // Flow: `a<>` as the only parameter of a function type; a decorator on a parameter of an arrow function.
    ["a.js", "--print-width=39", "//@flow\ndeclare module a{declare var b:a<>=>(p<((...a)=>v)>)}\n"],
    ["a.js", "", "//@flow\n(()=>{<a>(@d(h,()=>h,((()=>h)))@(()=>{})h)=>{``}},[])\n"],
    // A sequence in the parentheses of a cast of JSDoc, `{...a}` between tags with something behind it on its line.
    ["a.jsx", "--print-width=9", "{/**@type*/(a/**/,()=>[])}\n"],
    ["a.mjs", "--print-width=43", 'const{}=<a>{""}{...`${(<a/>+d).l()}`}{" "}<b>{d()}</b> b</a>\n'],
    // Comments: a block comment before `catch` where there are no semicolons, all there is in an array pattern, on both sides of an assignment operator, on lines of its own before the `>` of type arguments, before the `)` of a type in parentheses.
    ["a.jsx", "--print-width=15 --no-semi", "try{}\n/**@type*/catch(e){(c=>{e()})}\n"],
    ["a.mjs", "", "try{e()}catch([//\n]){}\n"],
    ["a.js", "--print-width=7", "e//\n+=//\n1\n"],
    ["a.tsx", "", "const a:b<X\n/**/>[]=``\n"],
    ["a.tsx", "", "const a:(X\n/**/)=``\n"],
    // `await (await a).b` in a template, with something in it that is filled.
    ["a.mjs", "--print-width=27", "{`${await(await c(<a>{} </a>)).a}`}\n"],
    // A call without arguments is a short argument by its name alone, whatever its type arguments are.
    ["a.tsx", "--print-width=15", "e=o(\ne<ayValue>()\n);\n"],
    ["a.tsx", "--print-width=15", "e=o(\ne<ayValue>()\n).g;\n"],
    // `<a />` is no group, so that what is measured anew behind a forced line break in a fill is what follows it.
    ["a.js", "--print-width=15 --tab-width=4", '<a><b>/<c/>\n<d/>\n</b>{<b/>}{" "}{b&<n/>}</a>\n'],
    ["a.js", "--print-width=13", '<a><b>x\n<d/>\n</b>{<b/>}{" "}{b&<n/>}</a>\n'],
    // A comment that waits for the end of the line, before something that ends the line for it.
    ["a.cjs", "--print-width=100000", "a||(//\n<a a={[<b/>,<c/>]}/>)\n"],
    ["a.tsx", "--print-width=100000", 'o||(//\n<a<{[t]:c}>a={""}/>)\n'],
    // What is awaited, and an element, in the parentheses of a cast of JSDoc.
    ["a.js", "--print-width=13", "await/**@type*/(await o).l\n"],
    ["a.jsx", "--print-width=10 --tab-width=6", "/**@type*/(await n).p\n"],
    ["a.jsx", "--print-width=6", '/**@type*/(<a>{""}</a>)\n'],
    // A pattern with nothing in it: with a type, as the only parameter; with a comment, in a catch clause.
    ["a.tsx", "--print-width=27", "function a({}:{l}):h<(l),l>\n"],
    ["a.ts", "--print-width=30", "const a=({}:{l}):h<l,l>=>{}\n"],
    ["a.tsx", "--print-width=47", "try{namespace o{}}catch({//\n}){declare function a():v}\n"],
    // A block comment with a line break in it before the `:` of a case.
    ["a.mjs", "--print-width=13", "{switch(e){case(``):default/*\nd*/:v=t()}}\n"],
    ["a.mjs", "--print-width=13", "{switch(e){default/*\nd*/:v=t()}}\n"],
    // A line comment on the line of a bracket of a computed key.
    ["a.tsx", "--print-width=4", "const{[1//\n]:a}\n"],
    ["a.js", "--print-width=4", "({[//\n1]:a})\n"],
    // Flow: `*` as the only parameter of a function type, one type behind a `|` or a `&`, a comment in a getter.
    ["a.js", "--print-width=21", "//@flow\n(<a>{()=>{(async function(){class \u00e9{\u6587:* =>[]}})}}</a>)\n"],
    ["a.js", "--print-width=23", "//@flow\n(<a>{//\n()=>{switch(a){case 1:{const l:{e:((*))=>e}=(5)}}}}</a>)\n"],
    ["a.js", "--print-width=89", '//@flow\n(async function(){(a=>{let d:/**/|a=""})})\n'],
    ["a.js", "--print-width=74", "//@flow\nfor(;;){type \u00e9=\u6587<//\n(|{\u00e9:g})/**/>}\n"],
    ["a.js.flow", "", "let d:/**/&a\n"],
    ["a.js", "--print-width=20", "//@flow\nconst a:{get \u00e9(/**/):{\u672c\u8a9e:T}}\n"],
    ["a.js.flow", "", "const a:{set e(/**/b:T):void}\n"],
    // Line comments in a member of an enum, comments on both sides of a `.`.
    ["a.ts", "--print-width=12", "enum a{b=//\naaaa.bbbb()}\n"],
    ["a.ts", "", "enum a{b=\n//c\n1}\n"],
    ["a.js", "--print-width=9", "x=e()//\n./**/b.c().d()\n"],
    // A line that is broken on a line with nothing on it.
    ["a.js", "--print-width=29 --trailing-comma=es5", "a(()=>()=>//\n()=>()=>()=>()=>()=>()=>()=>//\n()=>({}))\n"],
    // A cast of JSDoc is no simple argument.
    ["a.js", "--print-width=196", "o().c().d(/**@type*/(d))\n"],
    // `in` behind the value of a field is an operator, also in the head of a for.
    ["a.js", "", "for(e=class{e=n\nin\na};;){}\n"],
    ["a.ts", "", "for(e=class{e=n\nin\na};;){}\n"],
    // A comment in an index signature without a parameter.
    ["a.ts", "--print-width=131", "`${class<a>{a():c\n[/**/]}}`\n"],
    // Flow: `is` on the line behind the name that a function type returns.
    ["a.js.flow", "", "const d:()=>d\nis\ne\n"],
    ["a.js.flow", "", "type a=(d)=>d\nis\ne\n"],
    ["a.js", "", "//@flow\nconst\nd:()=>d\nis\n"],
    ["a.js", "--print-width=69", "//@flow\nclass\no{e:()=>a\nis}\n"],
    // A comment in the value of a field with a private name.
    ["a.cjs", "", "class e{#l=([]/**/)}\n"],
    // What is filled breaks in something that is printed flat.
    ["a.cjs", "--print-width=9", "a(()=>{(o())},+[1,23])\n"],
    // Comments: where an element of an array is left out, behind a line comment and a `)`, in a template literal type.
    ["a.mjs", "--print-width=88", "d=/**/[(h).l,//\n,/**/ /**/]\n"],
    ["a.jsx", "--print-width=32", "u(([]//\n)/**/ /**/)\n"],
    ["a.ts", "--print-width=47", "{type a=`${(unique//\nsymbol)}`}\n"],
    // A block comment on the next line, before a `;` or a `,`.
    ["a.d.ts", "--print-width=20", "const{}=a?.();\n/**/;/**/;(l)\n"],
    ["a.jsx", "--print-width=14", "({\na,[[]]:b\n/**/,/**/\nb})\n"],
    // Flow: `readonly` before a bracket in a tuple, `a<>` and a blank before a `)`.
    ["a.js", "--print-width=48", "//@flow\ntype a=[([])&e<{a:T}>,readonly[]]\n"],
    ["a.js", "--print-width=12", "//@flow\nasync function f(){(async()=>{if(a){c<(a<> )>(r())}else{t()}})}\n"],
    // TypeScript: `await` is a name in a namespace, also before a block comment.
    ["a.mts", "", "module a{await/**/(b)}\n"],
    ["a.ts", "--print-width=38", 'module""{e=(await/**/``)as e}\n'],
    // A conditional expression in the parentheses of a cast of JSDoc, before a call or a member.
    ["a.js", "--print-width=13", "await/**@type*/(a?class{}((e)):o)()\n"],
    ["a.js", "--print-width=13", "x=/**@type*/(aaaa?bbbb:cccc).d\n"],
    // A spread between tags behind a word.
    ["a.js", "--print-width=63", '<a>v{...it("",()=>{k})}</a>\n'],
    // Flow: a cast as a computed key, a comment before the type arguments of what is implemented.
    ["a.js", "--print-width=25 --tab-width=8", "//@flow\nif(d){({[(1:y)]:d})}\n"],
    ["a.js", "--print-width=81", "//@flow\nclass a extends o implements a\n//\n<>{static{export default{}}}\n"],
    // A list in the default value of a parameter of a function that may be hugged.
    ["a.jsx", "--print-width=21", 'a((a=a({f}))=>{("")})\n'],
    ["a.jsx", "--print-width=22", "a((a=b([f]))=>{c})\n"],
    // Flow: a cast among the items of a sequence.
    ["a.js", "--print-width=17", "//@flow\ne=(e,(h).a:(((a))))\n"],
    // Two arrow functions as the branches of a conditional expression, the second with parentheses.
    ["a.mjs", "", "const x = h ? () => (a) : (d) => t;\n"],
    ["a.mjs", "", "h?()=>({}):(d)=>t\n"],
    // Flow: `await` before a `<`, which the long way rejects in what may be parameters.
    ["a.js", "", "//@flow\n({a=(await<a>o</a>.a)}=b)\n"],
    ["a.js", "", "//@flow\n({a=[(await<a>o</a>.a)]}=((()=>{l()}))(()=>{(function(){})}))\n"],
    // Flow: a function type as what a type parameter extends, comments before the `?` of a parameter of a function type and behind the `...`.
    ["a.js", "--print-width=27", "//@flow\n[a=>{type a<a:(l)=>((...e)=>d)>=0}]\n"],
    ["a.js.flow", "--print-width=12", "type a<b:(l)=>d>=0\n"],
    ["a.js", "--print-width=30", "//@flow\n(c=>{type a=(d/**/?:{})=>[]})\n"],
    ["a.js", "--print-width=7", "//@flow\ntype a=(a,...//\n2)=>e\n"],
    // A comparison, a `?` and a `-`: no type arguments, and nothing to refuse.
    ["a.ts", "", "numbers.push((distance < 0 ? -distance * 2 - 1 : distance * 2) + 1);\n"],
    ["a.ts", "", "x=d<a?(-d):d\n"],
    // A conditional expression as the body of an arrow function gets no parentheses if it starts with an object, also through `as`, `satisfies` and `!`.
    ["a.ts", "", '()=>({e:""}as x?e:f)\n'],
    ["a.ts", "", '()=>({e:""}satisfies x?e:f)\n'],
    ["a.ts", "", '()=>({e:""}!?e:f)\n'],
    ["a.ts", "--print-width=58", '()=>({\u00e9:""}as{readonly[\u00e9 in \u6587]:\u00f1}?\u00e9:\u6587)\n'],
    // A value in the head of a `for` with `in`.
    ["a.jsx", "--print-width=87", 'for(var a=/**@type*/((b))in b)("")\n'],
    // `prettier-ignore` is about one statement or member, also where those that follow stand as they are printed, one level too deep.
    ["a.js", "", "o(\n  {\n    b() {\n      //prettier-ignore\n      a();\n      a;\n    },\n  },\n);\n"],
    ["a.js", "", "o(\n  {\n    b() {\n      /* prettier-ignore */\n      a();\n\n      a;\n    },\n  },\n);\n"],
    [
      "a.js",
      "",
      "o(\n  {\n    b() {\n      //prettier-ignore\n      if (a) {\n        b;\n      }\n      a;\n    },\n  },\n);\n",
    ],
    ["a.js", "", "o(\n  {\n    b: class {\n      //prettier-ignore\n      a = 1;\n      b = 2;\n    },\n  },\n);\n"],
    ["a.js", "", "o(\n  {\n    b: class {\n      //prettier-ignore\n      a() {}\n      b() {}\n    },\n  },\n);\n"],
    // A block comment that starts the next line, has a `/` behind its start, and is followed by a semicolon.
    ["a.d.ts", "--print-width=18", "const{}=a?.();\n/*/*/;/**/;(l)\n"],
    // A block comment on a line of its own between a property and its comma.
    ["a.jsx", "--print-width=14", "({\na,[[]]:b\n/**/\n,/**/\nb})\n"],
    ["a.jsx", "--print-width=14", "({\na,[[]]:b\n/**/ // c\n,\nb})\n"],
    // A template in another language in the parameters of a function that may be hugged.
    ["a.cjs", "--print-width=15", "a(({a=html`<a><`})=>{(<a></a>)})\n"],
    ["a.js", "--print-width=20", "a(({[html`<a>>`]:a},{a=()=>{}})=>{})\n"],
    ["a.cjs", "--print-width=20", "a(({a=html`<a>bbbbbbbbbbbb</a>`})=>{b})\n"],
    // A chain that starts with a short name, in the parentheses of a cast of JSDoc that is a statement.
    ["a.cjs", "--print-width=11", "{/**@type*/(e.a().c())}\n"],
    // `yield` as a computed key that is short.
    ["a.mjs", "--print-width=15 --tab-width=7", "class a{@a*a(){({[yield]:a})}}\n"],
  ];
  const groups = Map.groupBy(rows, ([name, flags]) => `${name} ${flags}`.trim());
  test.concurrent.each([...groups])("%s", async (_, group) => {
    const [[name, flags]] = group;
    const texts = group.map(row => row[2]);
    const { different, said, expected } = await differences(name, texts, flags.split(" ").filter(Boolean));
    expect(different).toEqual([]);
    expect(said).toEqual(expected);
  });

  // One thread formats one file after the other with the same scratch. A run that stops half way has set things that it does not put back.
  test("what is refused leaves nothing behind for the next file", async () => {
    const next = `x = [[1, 2], [3, 4]];
y = [{ a: 1, b: 2 }, { a: 3, b: 4 }];
const z = a ? b : c ? d : e;
f = (
  <g h="i">
    j {k} <l />
  </g>
);
m.n().o().p(q => r).s();
class T extends U {
  // v
  w = \`x\${y}z\`;
  static async *a(b, { c, d } = {}) {}
}
it.each\`
  a | b
  \${1} | \${2}
\`("c", () => {});
`;
    const texts = rows.filter(([name, flags]) => name === "a.js" && flags === "").flatMap(row => [next, row[2]]);
    const { different, said, expected } = await differences("a.js", [...texts, next], ["--threads=1"]);
    expect(different).toEqual([]);
    expect(said).toEqual(expected);
  });

  // The comment before `class` is refused, and what takes over pays for its own short cuts and for the long way.
  test("a class with many decorators takes linear time where it is refused", async () => {
    using dir = tempDir("format-short-cuts", { "a.js": "@a // c\n".repeat(isDebug ? 2_000 : 40_000) + "class A {}\n" });
    const cpu = async (own: string[]) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "fmt", "--check", "--no-config", "--no-editorconfig", "--log-level=silent", ...own, "a.js"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "ignore",
        stderr: "ignore",
      });
      expect(await proc.exited).toBe(0);
      // (Windows counts in ticks of 1/64 s)
      return Math.max(Number(proc.resourceUsage()?.cpuTime.total ?? 0) / 1e6, 1 / 64);
    };
    // 1.4 in a release build, and 17 when each decorator walked all of them.
    expect((await cpu([])) / (await cpu(["--no-short-cuts"]))).toBeLessThan(6);
  });
});

describe("JavaScript and Flow that the long way rejects", () => {
  /** Nothing is printed, with or without the short cuts, and the messages are the same. */
  function expectRejected(title: string, name: string, texts: string[]) {
    test.skipIf(!hasFlag).concurrent(title, async () => {
      const { different, said, expected } = await differences(name, texts, []);
      expect(different).toEqual([]);
      expect(said).toEqual(expected);
      expect(texts.filter((_, index) => !String(said[0]).includes(` ${index}/${name}:`))).toEqual([]);
    });
  }
  expectRejected("a.js", "a.js", [
    // parentheses that end the body of an arrow function before the `:` of a conditional expression, and what can be read as a type before a `{` or a `=>`
    "a?()=>(b):()=>{if(x){y}{z}}",
    "a?()=>(b):()=>({a(){if(x){y}{z}}})",
    "a?()=>(b):{a(){if(x){y}{z}}}",
    "a?c=()=>(b):c=>d",
    "a?c?d:()=>(b):()=>c=>d",
    // a call of `async` without arguments, or with a spread first, before the `:` of a conditional expression
    "a?async():b",
    "a?async(...x):b",
    // a test of a case that ends with parentheses where an arrow function could stand
    "switch($){case()=>(a):{if(b){c}}}",
    "switch($){case a=(b):{if(b){c}}}",
    "switch($){case a?b:(c):{if(b){c}}}",
    "switch($){case a,(b):{if(b){c}}}",
    "switch($){case async(b):{if(b){c}}}",
    "function*f(){switch($){case yield(b):{if(b){c}}}}",
    // `in` behind the value of a field, in the head of a for
    "for(e=class{e=n\nin};;){}",
    // await in the value of a field, in an object on several lines
    'class a{\na={\n"":await a}}',
    "class h{e(){}\na={\ne:await a}}",
    // `case (a): {`, which TypeScript tries as the head of an arrow function
    "switch($){case(a):{if(b){c}}}",
    "switch($){case(a):{switch(b){case 1:}}}",
    // jumps
    "function f() {\n  a();\n  break;\n}\n",
    "function f() {\n  if (a) {\n    continue;\n  }\n}\n",
    "for (const a of b) {\n  c(() => {\n    break;\n  });\n}\n",
    "while (a) {\n  function f() {\n    continue;\n  }\n}\n",
    "switch (a) {\n  case 1:\n    continue;\n}\n",
    "if (a) {\n  break;\n}\n",
    "class A {\n  m() {\n    break;\n  }\n}\n",
    "for (;;) {\n  class A {\n    a = () => {\n      break;\n    };\n  }\n}\n",
    // labels
    "a: for (;;) {\n  break b;\n}\n",
    "a: {\n  continue a;\n}\n",
    "a: for (;;) {\n  a: for (;;) {\n    b();\n  }\n}\n",
    "a: for (;;) {\n  function f() {\n    break a;\n  }\n}\n",
    // super
    "function f() {\n  super.a();\n}\n",
    "class A {\n  constructor() {\n    super();\n  }\n}\n",
    "class A extends B {\n  m() {\n    super();\n  }\n}\n",
    "class A extends B {\n  constructor() {\n    function f() {\n      super();\n    }\n  }\n}\n",
    "const a = {\n  b: function () {\n    super.c();\n  },\n};\n",
    "class A extends B {\n  a = super();\n}\n",
    // constructor
    "class A {\n  constructor() {\n    a();\n  }\n  constructor() {\n    b();\n  }\n}\n",
    "class A {\n  get constructor() {\n    return 1;\n  }\n}\n",
    "class A {\n  async constructor() {\n    a();\n  }\n}\n",
    "class A {\n  *constructor() {\n    a();\n  }\n}\n",
    "class A {\n  constructor = 1;\n}\n",
    "class A {\n  static prototype = 1;\n}\n",
    "class A {\n  static prototype() {\n    a();\n  }\n}\n",
    // private
    "class A {\n  #a = 1;\n  #a = 2;\n}\n",
    "class A {\n  #a() {\n    b();\n  }\n  #a = 1;\n}\n",
    "class A {\n  #constructor = 1;\n}\n",
    "class A {\n  #a = 1;\n  m() {\n    delete this.#a;\n  }\n}\n",
    "class A {\n  get #a() {\n    return 1;\n  }\n  get #a() {\n    return 2;\n  }\n}\n",
    // accessors
    "class A {\n  get a(b) {\n    return b;\n  }\n}\n",
    "class A {\n  set a() {\n    b();\n  }\n}\n",
    "class A {\n  set a(b, c) {\n    d();\n  }\n}\n",
    "const a = {\n  get b(c) {\n    return c;\n  },\n};\n",
    "const a = {\n  set b(...c) {\n    d();\n  },\n};\n",
    // default
    "export default a;\nexport default b;\n",
    "export default function f() {\n  a();\n}\nexport default class A {}\n",
    "export default a;\nexport { b as default };\n",
    'export { a as default };\nexport { b as default } from "c";\n',
    // strict
    'function f(a = 1) {\n  "use strict";\n  b();\n}\n',
    'function f({ a }) {\n  "use strict";\n  b();\n}\n',
    'function f(...a) {\n  "use strict";\n  b();\n}\n',
    'const f = (a = 1) => {\n  "use strict";\n  b();\n};\n',
    'class A {\n  m([a]) {\n    "use strict";\n    b();\n  }\n}\n',
    'const a = {\n  m(b = 1) {\n    "use strict";\n    c();\n  },\n};\n',
    // rest
    "function f(...a, b) {\n  c();\n}\n",
    "const f = (...a, b) => {\n  c();\n};\n",
    "const [...a, b] = c;\n",
    "const { ...a, b } = c;\n",
    "f(async (a, ...b, c) => {\n  d();\n});\n",
    "class A {\n  m(...a, b) {\n    c();\n  }\n}\n",
    // proto
    "const a = {\n  __proto__: b,\n  __proto__: c,\n};\n",
    'f({\n  __proto__: a,\n  "__proto__": b,\n});\n',
    // await
    "async function f(a = await b) {\n  c();\n}\n",
    "const f = async (a = await b) => {\n  c();\n};\n",
    "class A {\n  static {\n    await;\n  }\n}\n",
    // yield
    "function* f(a = yield) {\n  b();\n}\n",
    "function* f() {\n  function* g(a = yield) {\n    b();\n  }\n}\n",
    // arguments
    "class A {\n  a = arguments;\n}\n",
    "class A {\n  a = () => {\n    b(arguments);\n  };\n}\n",
    "class A {\n  static {\n    a(arguments);\n  }\n}\n",
    // exports
    "export { if };\n",
    "export { a, default };\n",
    'export { "a" };\n',
    'export { "a" as b };\n',
    "export { enum };\n",
    // imports
    'import { if } from "a";\n',
    'import { a as if } from "b";\n',
    'import { "a" } from "b";\n',
    'import { enum } from "a";\n',
    'import { default } from "a";\n',
    // names
    "const enum = 1;\n",
    "function f(enum) {\n  a();\n}\n",
    "const a = {\n  enum,\n};\n",
    "const { if } = a;\n",
    "let let = 1;\n",
    "const let = 1;\n",
    // targets
    "function f() {\n  a() = 1;\n}\n",
    "function f() {\n  a()++;\n}\n",
    "function f() {\n  ++a?.b;\n}\n",
    "for (a() of b) {\n  c();\n}\n",
    // operands
    "function f() {\n  return -a ** b;\n}\n",
    "function f() {\n  return a ?? b || c;\n}\n",
    "function f() {\n  return a && b ?? c;\n}\n",
    "function f() {\n  return a || () => b;\n}\n",
    "function f() {\n  return typeof () => a;\n}\n",
    "function f() {\n  return new a?.b();\n}\n",
    "function f() {\n  return a?.b`c`;\n}\n",
    "function f() {\n  return new.a;\n}\n",
    'function f() {\n  return new import("a");\n}\n',
    // bodies
    "if (a) const b = 1;\n",
    "if (a) class B {}\n",
    "for (;;) let a = 1;\n",
    "if (a) {\n  b();\n} else const c = 1;\n",
    "a: class B {}\n",
    "function f() {\n  if (a) let b = 1;\n}\n",
    // statements
    "function f() {\n  throw;\n}\n",
    "switch (a) {\n  default:\n    b();\n  default:\n    c();\n}\n",
    "function () {\n  a();\n}\n",
    "for await (a in b) {\n  c();\n}\n",
    "for (async of a) {\n  b();\n}\n",
    "for (let.a of b) {\n  c();\n}\n",
    // objects
    "const a = {\n  b = 1,\n};\n",
    "f({\n  a = 1,\n});\n",
    "const a = {\n  get b,\n};\n",
    "const a = {\n  async b: 1,\n};\n",
    // numbers
    "const a = 1_;\n",
    "const a = 1__0;\n",
    "const a = 0x;\n",
    "const a = 0b2;\n",
    "const a = 01n;\n",
    // strings
    'const a = "\\u{110000}";\n',
    'const a = "\\u12";\n',
    'const a = "\\x1";\n',
    "const \\u0061 = 1;\nconst cl\\u0061ss = 1;\n",
    // regexes
    "const a = /b/gg;\n",
    "const a = /b/x;\n",
    "const a = /b/uv;\n",
    // jsx
    "const a = <b.c-d />;\n",
    "const a = <b c={d, e} />;\n",
    "const a = <b c={...d} />;\n",
    // decorators
    "@a\nexport @b class C {}\n",
    "class A {\n  @a\n  constructor() {\n    b();\n  }\n}\n",
    "const a = () => @b class {};\n",
    // using
    "switch (a) {\n  case 1:\n    using b = c;\n}\n",
    "for (using a in b) {\n  c();\n}\n",
    // quirks
    "static\nvar a;\n",
    "class A extends {}.B {}\n",
    "class A {\n  export\n  a;\n}\n",
    "export default interface;\n",
    // ts-shared
    "var\ufeff\n",
    "function f() {\n  break\u00a0;\n}\n",
  ]);
  expectRejected("a.js.flow", "a.js.flow", [
    // a call of `async` without arguments, or with a spread first, before the `:` of a conditional expression
    "a?async():b",
    // `is` on the line behind the name that a function type returns, and nothing behind it
    "const d:()=>d\nis",
    "type a=()=>d\nis",
    "declare function f(d):d\nis",
    // a backslash in the word behind what may be the type parameters of a function
    "x=<div>\\</div>",
    "f(<div>a\\</div>)",
    "a=(\n<div>\\</div>\n)",
    "<div b={<c>\\</c>}/>",
    "function A(){\nreturn (\n<div>\\<b/></div>\n);\n}",
    // type parameters of an arrow function: with a variance, with a word of the language for a name
    "a=<+a>()=>b",
    "a=async<-a>()=>b",
    "a=<void>()=>c",
    "a=<null>()=>c",
    "a=<typeof>()=>c",
    "a=<extends>()=>c",
    "a=<enum>()=>c",
    // a name of JSX that goes on beyond ASCII behind a `-`
    '<a b-é={""}/>',
    "<a-é/>",
    '<a é-文={""}/>',
    // an interface without a name as the default export
    "declare export default interface{d:l}",
    // type arguments in the parentheses of a superclass
    "class a extends(d<x>){}",
    "class a extends(d<x>,e){}",
    "class a extends(d<x>||e){}",
    "class a extends(a<a<b<{():t}>>>){}",
    // jumps
    "function f() {\n  a();\n  break;\n}\n",
    // super
    "function f() {\n  super.a();\n}\n",
    // constructor
    "class A {\n  constructor() {\n    a();\n  }\n  constructor() {\n    b();\n  }\n}\n",
    // private
    "class A {\n  #a = 1;\n  #a = 2;\n}\n",
    // accessors
    "class A {\n  get a(b) {\n    return b;\n  }\n}\n",
    // default
    "export default a;\nexport default b;\n",
    // strict
    'function f(a = 1) {\n  "use strict";\n  b();\n}\n',
    // rest
    "function f(...a, b) {\n  c();\n}\n",
    // proto
    "const a = {\n  __proto__: b,\n  __proto__: c,\n};\n",
    // await
    "async function f(a = await b) {\n  c();\n}\n",
    // yield
    "function* f(a = yield) {\n  b();\n}\n",
    // exports
    "export { if };\n",
    // imports
    'import { if } from "a";\n',
    // names
    "const enum = 1;\n",
    "function f(enum) {\n  a();\n}\n",
    // targets
    "function f() {\n  a() = 1;\n}\n",
    // operands
    "function f() {\n  return -a ** b;\n}\n",
    // bodies
    "if (a) const b = 1;\n",
    // objects
    "const a = {\n  b = 1,\n};\n",
    // numbers
    "const a = 1_;\n",
    // strings
    'const a = "\\u{110000}";\n',
    // regexes
    "const a = /b/gg;\n",
    // flow-names
    "type string = a;\n",
    "type if = a;\n",
    "export type number = a;\n",
    "interface void {}\n",
    "opaque type null = a;\n",
    "declare class false {}\n",
    "declare function if(): void;\n",
    'import { type if } from "a";\n',
    'import type { typeof } from "a";\n',
    "component as() {}\n",
    "enum enum {}\n",
    // flow-lines
    "export type\nA = b;\n",
    "declare\nfunction f(): void;\n",
    "declare export type\nA = b;\n",
    // flow-lists
    "a<>;\n",
    "type A<> = b;\n",
    "function f<>() {}\n",
    "class A<> {}\n",
    "const a = <>() => b;\n",
    // flow-arguments
    "a<b>;\n",
    "const a = b<c>.d;\n",
    "class A extends B<c>.d {}\n",
    "async<a>(b);\n",
    // flow-records
    "const a = b {};\n",
    "const a = b { c: 1 };\n",
    "const a = new B { c: 1 };\n",
    // flow-casts
    "(a: b, c);\n",
    "((a: b)) => c;\n",
    "((a): b) => c;\n",
    "async (a: b);\n",
    "const f = ({ a() {} }: b) => c;\n",
    "const f = ({ a: 1 }: b) => c;\n",
    // flow-bodies
    "function f();\n",
    "function f(): a;\n",
    "export function f(): a;\n",
    // flow-objects
    "type A = {| a: 1 };\n",
    "type A = { a: 1 |};\n",
    "type A = { +a(): 1 };\n",
    "type A = { +...a };\n",
    "type A = {\n  a: 1,\n  ...\n    | B\n    | C,\n};\n",
    "type A = { get a: 1 };\n",
    "type A = { in a: 1 };\n",
    // flow-types
    "let a: keyof;\n",
    "let a: interface;\n",
    "let a: component;\n",
    "let a: number.b;\n",
    "let a: string<>;\n",
    // flow-this
    "function f(this = 1) {}\n",
    "function f(this?: a) {}\n",
    "function f(...this) {}\n",
    "class A {\n  set a(this: b) {}\n}\n",
    // flow-members
    "class A {\n  +a() {}\n}\n",
    "class A {\n  +get a() {}\n}\n",
    "class A {\n  a b;\n}\n",
    "class A {\n  constructor?() {}\n}\n",
    "class A {\n  writeonly a: b;\n}\n",
    // flow-heritage
    "class A implements null {}\n",
    "declare class A extends B, C {}\n",
    // flow-jsx
    "const a = <b>}</b>;\n",
    "const a = <b>c > d</b>;\n",
    // flow-match
    "const a = match (b) {\n  x[y] => c,\n};\n",
    "const a = match (b) {\n  -c => d,\n};\n",
    "const a = match (b) {\n  let => d,\n};\n",
    // flow-declare
    "declare opaque a b;\n",
    "component A('a': c) {}\n",
    "component A(...a: b\n",
    "export default a;\ndeclare export default b;\n",
    "declare export { if };\n",
    "module as A;\n",
    'import type defer * as a from "b";\n',
    "component A(@a b) {}\n",
  ]);
  expectRejected("a.mjs", "a.mjs", [
    // the same before a chain of arrow functions
    "a?()=>(b):(c)=>d=>e",
    // parentheses as the body of an arrow function before the `:` of a conditional expression and another arrow function
    "h?()=>({}):d=>(t)",
    "h?()=>(a):d=>t",
    "h?()=>()=>(a):d=>t",
    "h?async()=>(a):d=>t",
    // await in the value of a field, in an object on several lines
    'class a{\na={\n"":await a}}',
    // default
    "export default a;\nexport default b;\n",
  ]);
  expectRejected("a.jsx", "a.jsx", [
    // default
    "export default a;\nexport default b;\n",
    // jsx
    "const a = <b.c-d />;\n",
    "const a = <b c={d, e} />;\n",
    "const a = <b c={...d} />;\n",
  ]);
  expectRejected("a.ts", "a.ts", [
    // await
    'import a from "b";\nconst c = await;\n',
    "const c = await;\nexport { c };\n",
    // targets
    "function f() {\n  a()++;\n}\n",
    // operands
    "function f() {\n  return -a ** b;\n}\n",
    // statements
    "function f() {\n  throw;\n}\n",
    "switch (a) {\n  default:\n    b();\n  default:\n    c();\n}\n",
    // numbers
    "const a = 1_;\n",
    "const a = 1__0;\n",
    "const a = 0x;\n",
    "const a = 0b2;\n",
    "const a = 01n;\n",
    "const a = 010;\n",
    "const a = 09;\n",
    // strings
    'const a = "\\u{110000}";\n',
    'const a = "\\u12";\n',
    'const a = "\\x1";\n',
    'const a = "\\01";\n',
    "const \\u0061 = 1;\nconst cl\\u0061ss = 1;\n",
    // ts-shared
    "a?.#b;\n",
    "class A {\n  #b = 1;\n  m() {\n    return a?.c.#b;\n  }\n}\n",
    "new import.meta();\n",
    "<a>b ** c;\n",
    "namespace enum {}\n",
    "declare function (): void;\n",
    "let a: [enum];\n",
    "type A = B<enum>;\n",
    "type A = (enum) => void;\n",
    'import { type enum } from "a";\n',
    "yield as any;\n",
    "await in a;\n",
    "a << b.c > (d);\n",
    "var\ufeff\n",
    "enum A {\n  a = await\n  b,\n}\n",
    "namespace N {\n  await {};\n}\n",
    "await\n** a;\n",
    "f<unique>(a);\n",
    "f<a | <T>(b)>(c);\n",
  ]);
  expectRejected("a.tsx", "a.tsx", [
    // jsx
    "const a = <b.c-d />;\n",
  ]);
  expectRejected("a.cjs", "a.cjs", [
    // a name of JSX that goes on beyond ASCII behind a `-`, in what is parsed a second time
    "export default{a(){return{a:c=>{(<a é-文><b></b></a>)}}}}",
    // using
    "using a = b;\n",
  ]);
  expectRejected(
    "a.js with @flow",
    "a.js",
    [
      // flow-names
      "type string = a;\n",
      "type if = a;\n",
      "export type number = a;\n",
      "interface void {}\n",
      "opaque type null = a;\n",
      "declare class false {}\n",
      "declare function if(): void;\n",
      'import { type if } from "a";\n',
      'import type { typeof } from "a";\n',
      // flow-lines
      "export type\nA = b;\n",
      "declare export type\nA = b;\n",
      // flow-lists
      "a<>;\n",
      "type A<> = b;\n",
      "function f<>() {}\n",
      "class A<> {}\n",
      "const a = <>() => b;\n",
      // flow-arguments
      "a<b>;\n",
      "const a = b<c>.d;\n",
      "class A extends B<c>.d {}\n",
      "new A<b>c;\n",
      // flow-casts
      "(a: b, c);\n",
      "((a: b)) => c;\n",
      "((a): b) => c;\n",
      "async (a: b);\n",
      "const a = b ? ((c: d)) => {} : e;\n",
      "const f = ({ a() {} }: b) => c;\n",
      "const f = ({ a: 1 }: b) => c;\n",
      // flow-objects
      "type A = {| a: 1 };\n",
      "type A = { a: 1 |};\n",
      "type A = { +a(): 1 };\n",
      "type A = { +...a };\n",
      "type A = {\n  a: 1,\n  ...\n    | B\n    | C,\n};\n",
      "type A = { get a: 1 };\n",
      // flow-types
      "let a: keyof;\n",
      "let a: interface;\n",
      "let a: component;\n",
      "let a: number.b;\n",
      "let a: string<>;\n",
      // flow-this
      "function f(this = 1) {}\n",
      "function f(this?: a) {}\n",
      "function f(...this) {}\n",
      "class A {\n  set a(this: b) {}\n}\n",
      // flow-members
      "class A {\n  +a() {}\n}\n",
      "class A {\n  +get a() {}\n}\n",
      // flow-heritage
      "class A implements null {}\n",
      "declare class A extends B, C {}\n",
      // flow-declare
      'import type defer * as a from "b";\n',
      "export type as = a;\n",
    ].map(text => `// @flow\n${text}`),
  );
  expectRejected("a.js, words and keys", "a.js", [
    // an arrow function as a decorator
    "@(a) => b class A {}\n",
    "@() => {} class A {}\n",
    "class A { @() => {} m() {} }\n",
    "class A { m(@(a) => b c) {} }\n",
    // a decorator in front of `static constructor`
    "class A { @a static constructor() {} }\n",
    // `constructor`, `prototype` and `__proto__` with an escape
    'class A { "\\u0063onstructor" = 1 }\n',
    'class A { "\\u{63}onstructor" }\n',
    'class A { "constructo\\x72"() {} constructor() {} }\n',
    'class A { get "\\constructor"() {} }\n',
    'class A { async "con\\\nstructor"() {} }\n',
    'class A { *"c\\157nstructor"() {} }\n',
    'class A { static "\\x70rototype"() {} }\n',
    'class A {\n  static "prot\\u006ftype" = 1;\n}\n',
    '({ __proto__: a, "__pr\\u006fto__": b });\n',
    'x = {\n  "\\x5f_proto__": 1,\n  __proto__: 2,\n};\n',
    // `async <`, which starts a function for TypeScript's parser
    "x = [async<o, p]\n",
    "x = [async < o, p];\n",
    // parentheses as the operand of `yield` before the `:` of a conditional expression
    "function* f() { x = a ? yield (b) : c => d }\n",
    "function* f() { x = a ? yield* (b) : c => {} }\n",
    "function* f() { x = a ? y = yield (b = 1) : c => d => e }\n",
    // `implements` as the name of a class
    "class implements extends B {\n  a = 1;\n}\n",
    // words that TypeScript's parser takes for modifiers of the next line
    "class A {\n  default\n  @a b = 1;\n}\n",
    "class X {\n  accessor static\n  b\n}\n",
    "class X {\n  accessor get\n  b\n}\n",
  ]);
  expectRejected("a.js.flow, what only Flow has", "a.js.flow", [
    // two expressions behind `%checks`
    "declare function f(x: mixed): boolean %checks(a, b);\n",
    "function f(x: mixed): boolean %checks(a, b) {}\n",
    // two modifiers, `@@` in pieces
    "declare class A { proto static a: T }\n",
    "type A = { @ @iterator(): T };\n",
    "type A = { @ @iterator: T };\n",
    // the type of a component
    "type A = component(...a?, T);\n",
    "type A = component(...a: T, b: U);\n",
    // a component
    "component A(this: T) {}\n",
    "component A(this) {}\n",
    "component A('a' as this: T) {}\n",
    "component A(a as this) {}\n",
    'component A(a = 1) { "use strict" }\n',
    "component A() { super.a }\n",
    "export default async component A() {}\n",
    "export default async hook useA() {}\n",
    'export default component A() {}\ndeclare export { default } from "a";\n',
    'export default a;\ndeclare export { b as default } from "a";\n',
    'export default a;\ndeclare export * as default from "a";\n',
    // a component that is declared has the parameters of a type
    "declare component A('a' as b: T);\n",
    "declare component A(a as b: T);\n",
    "declare component A(a = 1);\n",
    "declare component A(a: T = 1);\n",
    "declare component A({ a }: T);\n",
    "declare component A(...{ a }: T);\n",
    "declare module A { component B(a = 1); }\n",
    "declare module A { component B(a: T) {} }\n",
    "declare module A { declare component B('a' as b: T); }\n",
    "declare namespace A { component B(a as b: T); }\n",
    "declare namespace\nA {}\n",
    // a record
    "record A { [a]: T }\n",
    "record A { #a: T }\n",
    "record A { async async: T }\n",
    "record A { *a: T }\n",
    "record A { m(): T {}, n(): U {} }\n",
    "record A { a: T = arguments }\n",
    "record A { a: T = () => arguments }\n",
    "record A { a: T = super() }\n",
    "async function f() { record A { a: T = await b } }\n",
    "function* f() { record A { a: T = yield b } }\n",
    // match
    "x = match (a) { {...,} => c };\n",
    "x = match (a) { [...,] => c };\n",
    "x = new match (a) { b => c };\n",
    "class A extends match (a) { b => c } {}\n",
    // a declaration that starts with a name, as the body of a statement
    "if (a) async component B() {}\n",
    "if (a) {} else async hook useB() {}\n",
    "label: async component B() {}\n",
    "if (a) record A {}\n",
    "for (;;) record A {}\n",
    "do record A {} while (a)\n",
    "label: record A {}\n",
    // an arrow function as a decorator
    "@(a) => b class A {}\n",
    "async () => { class a { b(@(await(x)) c) {} } };\n",
    // `constructor`, `prototype` and `__proto__` with an escape
    'class A { "\\u0063onstructor" = 1 }\n',
    'class A { static "\\x70rototype": T }\n',
    // `async <`, which Flow's parser does not take for a call
    "x = async\n<T>(a)\n",
    "x = async << a\n",
    "async\n<< a\n",
    "a = async ((x) => x: any);\n",
    "x = a as const < b\n",
    "x = a as const\n< b;\n",
    // a modifier and a name: an index signature
    "class A {\n  [declare as a]: T;\n}\n",
    // text behind `<a>` that is no token: the long way tries type parameters
    '<A>"</A>;\n',
    "<a>'</a>;\n",
    "<a>`</a>;\n",
    "<a>#1 text</a>;\n",
    "<a>1st</a>;\n",
    "<a>0b2</a>;\n",
    "<a>/*</a>;\n",
    "<b>\u00a7</b>;\n",
    "<b>\ud83d\ude00</b>;\n",
    "x = (\n  <Text>\n    #1 text\n  </Text>\n);\n",
    "x = (\n  <a>\n    1st\n  </a>\n);\n",
    "f(<a>'</a>);\n",
    "x = <a>{<b>'</b>}</a>;\n",
    // white space in front of the value of an attribute, and a backslash in it
    'x = <a b = "\\u" />;\n',
    'x = <a b=\n"\\@" />;\n',
    'x = <a b=\n\n"aa\\@bb" c="d" />;\n',
    // a line break in front of the `=>` behind a return type
    "a ? ((b): c\n => d) : e;\n",
    // `extends` and `implements` where a type or a name goes on
    "class A {\n  a: B\n  extends = 1;\n}\n",
    "class A implements implements {}\n",
    "class A implements implements {\n  a: T;\n}\n",
    "function f(): enum is T {}\n",
    "type A = B extends () => infer R extends C ? D : E;\n",
    "type A = B extends C => infer R extends C ? D : E;\n",
    "x = (a): T extends U ? V : W => b;\n",
    "class A implements enum {}\n",
    "declare export default enum;\n",
    "function f(a): implies enum is T {}\n",
    "function f(a): asserts enum {}\n",
    "type A = infer enum;\n",
    "for (let a: (a: T) => implies of b);\n",
    "class A extends B<<T>() => void>\n{}\n",
  ]);
  expectRejected(
    "a.js with @flow, what only Flow has",
    "a.js",
    [
      // text behind `<a>` that is no token: the long way tries type parameters
      "<a>'</a>;\n",
      "x = (\n  <a>\n    1st\n  </a>\n);\n",
    ].map(text => `// @flow\n${text}`),
  );
  expectRejected("a.d.ts", "a.d.ts", [
    // ts-shared
    "await /a/;\n",
  ]);
});

// What the quick way's parser takes for another program than the long way's, or reads alike and the long way prints in a way of its
// own: the result is the long way's.
describe("programs that are read as written", () => {
  describe("TypeScript", () =>
    expectSame(
      "a.ts",
      [
        // a declaration that starts with a name, as the body of a statement
        "while (a) declare enum E {}\n",
        "if (a) declare const enum E {}\n",
        "if (a) b;\nelse declare enum E {}\n",
        // type arguments that end far away
        "f(a < b!, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, c > (d));\n",
        "f(a < !b, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, c > (d));\n",
        // `await` and `yield` in a computed key of a type
        "type A = { [await(x).y]: B }\n",
        "type A = { [await (x)]: B }\n",
        // `await of`
        "await\nof;\n",
        // an operator with `=` in a pattern
        "({ a: b += 1 } = c)\n",
        "({ a: { b: c *= 1 } } = d);\n",
        // tuples and index signatures that the long way prints as they are written
        "type A = [(Foo<a,b>?)];\n",
        "type A = [...(b)?];\n",
        "type A = [...a?:  typeof string[]];\n",
        "interface A {\n  [b: {\n    c: d }]: e;\n}\n",
      ],
      [[]],
    ));
  describe("JavaScript", () =>
    expectSame(
      "a.js",
      [
        // `await of`
        "await\nof;\n",
        // a character that is not printable behind a backslash
        'x = f("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\\u007f");\n',
        "x = f(`aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\\u007f`);\n",
        "x = f(/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\\t/);\n",
        "x = f(/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\\u0001/);\n",
      ],
      [[]],
    ));
  describe("Flow", () =>
    expectSame(
      "a.js.flow",
      [
        // the `(` behind `%checks` stands on another line
        'declare function f(x: mixed): boolean %checks\n  (typeof x === "string");\n',
        "declare export function f(x: mixed): boolean %checks\n(!!x);\n",
        "declare function f(x: mixed): boolean %checks\n\n(x);\n",
        "declare function f(x: mixed): boolean %checks // c\n(x);\n",
        // `proto`, `static`, `+` and `get` in front of a member that has no place for them
        "declare class A { proto(): T }\n",
        "declare class A { proto<X>(): T }\n",
        "declare class A { proto [k: string]: T }\n",
        "declare class A { proto [[a]]: T }\n",
        "type A = { +[[a]]: T };\n",
        "declare class A { static -[[a]]: T }\n",
        "declare class A { static [K in T]: U }\n",
        "declare class A { proto [K in T]: U }\n",
        "declare class A { get @@iterator(): T }\n",
        "type A = { set @@iterator(a: T): void };\n",
        "declare class A { static /* c */ @@iterator: T }\n",
        "interface A { 'new'(): b }\n",
        "type A = (...this: T) => U;\n",
        "declare function f(...this: T): U;\n",
        // what the long way prints in its own way
        "x = match (v) { a if (g, h) => r };\n",
        "match (v) { a.b[1] => {} }\n",
        "match (v) { a.b.c => {} }\n",
        "match (v) { a.b | c[1] => {} }\n",
        "component A(value: string, onChangeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee: (string) => void);\n",
        "declare component A(...{\n  a: T,\n});\n",
        "declare module 'a' { 'use strict' }\n",
        "declare namespace N { 'a'; b }\n",
        // a cast as a decorator
        "@(a: c) class D {}\n",
        // what is read across the end of a line, or dropped
        "x;\na < keyof \nb > (c);\ny;\n",
        "(...a?) => 1;\n",
        "(a, ...b ? ,) => 1\n",
        // no type arguments, a comment in front of the name of a type parameter, the comment of a cast
        "declare class A extends D<> {}\n",
        "type A<in /* c */ T> = T;\n",
        "type A<out /* c */ T> = T;\n",
        "function f<const /* keep me */ T>(a: T) {}\n",
        "opaque type A super T.U.V;\n",
        "type A = hook () => T => X;\n",
        "[].reduce(() => {\n  [];\n}, ([]: Array<>\n));\n",
        "const a =\n  /** @type {X} */\n  (b);\n",
      ],
      [[], ["--print-width=10"]],
    ));
  describe("Flow, read by Babel", () =>
    expectSame(
      "a.js",
      [
        // the `(` behind `%checks` stands on another line
        "declare function f(x: mixed): boolean %checks\n(!!x);\n",
        // `proto`, `static`, `+` and `get` in front of a member that has no place for them
        "declare class A { proto(): T }\n",
        "type A = { +[[a]]: T };\n",
        // a cast as a decorator
        "@(a ?? b: c) class D {}\n",
      ].map(text => `// @flow\n${text}`),
      [[]],
    ));
  test.skipIf(!hasFlag).concurrent("bytes that are no text behind a backslash", async () => {
    const files: [string, Buffer][] = [
      ["a.js.flow", Buffer.from('x = "\\\xff";\n', "latin1")],
      ["a.js.flow", Buffer.from("x = `\\\xff`;\n", "latin1")],
      ["a.js.flow", Buffer.from("x = /\\\xff/;\n", "latin1")],
      [
        "a.js",
        Buffer.from(
          'x = f("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\\xff");\n',
          "latin1",
        ),
      ],
      [
        "a.ts",
        Buffer.from(
          'x = f("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\\xc3");\n',
          "latin1",
        ),
      ],
    ];
    const tree = Object.fromEntries(files.map(([name, bytes], index) => [`${index}/${name}`, bytes]));
    const [short, long] = await Promise.all(
      [[], ["--no-short-cuts"]].map(async own => {
        using dir = tempDir("format-short-cuts", tree);
        await using proc = Bun.spawn({
          cmd: [bunExe(), "fmt", "--write", "--no-config", "--no-editorconfig", "--log-level=warn", ...own, "."],
          cwd: String(dir),
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        const written = Object.keys(tree).map(name => readFileSync(join(String(dir), name)).toString("latin1"));
        return { written, said: `${stdout}${stderr}`.split("\n").sort().join("\n"), exitCode };
      }),
    );
    expect(short).toEqual(long);
  });
});

describe("an `if` with a statement that is no block on its line", () => {
  const clauses = [
    "return",
    "return;",
    "return a && b;",
    "return 'a';",
    "return a, b;",
    "return { a: 1 };",
    "return () => {};",
    "return (\n    a\n  );",
    "return\n  a;",
    "throw new Error('x');",
    "throw",
    "break",
    "break;",
    "break a;",
    "continue;",
    "a();",
    "a()",
    "a.b.c(d,e);",
    "a = b",
    "a=b;",
    "a++;",
    "++a;",
    "a = b = c;",
    "a = {\n    b: 1,\n  };",
    "a = () => {};",
    "this.a = b;",
    "super.a();",
    "new A();",
    "await a();",
    "yield a;",
    "delete a.b;",
    "let a;",
    "let = 1;",
    "const a = 1;",
    "function g() {}",
    "async();",
    "type = 1;",
    "type A = 1;",
    "declare = 1;",
    "module.exports = a;",
    "a: b;",
    ";",
    "if (b) c();",
    "if (b) c(); else d();",
    "a(() => {\n    b();\n  });",
    "a(\n    b,\n  );",
    "a\n    .b();",
    "a(); // c",
    "a(); /* c */",
    "/* c */ a();",
    "return // c",
    "a.b(x => x).c(y => y).d();",
    "it('x', () => {});",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa();",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa();",
    "return aaaaaaaaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbb(cccccccc, ddd);",
  ];
  const followers = [
    "",
    " else b();",
    "\n  else b();",
    "\n  // c\n  else b();",
    "\n  (b)",
    "\n  .b",
    "\n\n  b();",
    "\n  elsewhere();",
  ];
  const around: [string, string][] = [
    ["async function* f() {\n  ", "\n}\n"],
    ["a: for (;;) {\n  ", "\n}\n"],
    ["class A extends B {\n  m() {\n  ", "\n  }\n}\n"],
    ["function f() {\n  // prettier-ignore\n  ", "\n}\n"],
  ];
  const texts = around.map(([before, after]) =>
    clauses.flatMap(clause => followers.map(follower => `${before}if (!a) ${clause}${follower}${after}`)),
  );
  const heads = [
    "if(a) b();\n",
    "if (a)b();\n",
    "if  ( a )  b();\n",
    "if (a)\n  b();\n",
    "if (a) /* c */ b();\n",
    "if (a) // c\n  b();\n",
  ];
  const options = [[], ["--print-width=30"], ["--no-semi", "--single-quote"], ["--use-tabs", "--end-of-line=crlf"]];
  describe.each([...texts, heads].map((texts, index) => [index, texts] as const))("group %i", (_, texts) => {
    describe("TypeScript", () => expectSame("a.ts", texts, options));
    describe("JavaScript", () => expectSame("a.js", texts, options));
    describe("Flow", () => expectSame("a.js.flow", texts, [[]]));
  });
});
