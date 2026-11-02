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
