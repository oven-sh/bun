// The parser of components against `svelte/compiler`, and what takes scripts and style sheets out of a text against the plugin's own function.
//
//   bun trees.cjs <bun-lint> <directory with node_modules/svelte and prettier-plugin-svelte> <directory with .svelte files>
//
// `<bun-lint>`: the harness, for `format svelte-trees`. The trees are compared as far as the plugin looks at them, with offsets in bytes.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const [bin, packages, directory] = process.argv.slice(2).map(it => path.resolve(it));
const { parse } = require(path.join(packages, "node_modules/svelte/compiler"));
const plugin = fs.readFileSync(path.join(packages, "node_modules/prettier-plugin-svelte/plugin.js"), "utf8");
const files = fs
  .readdirSync(directory, { recursive: true, encoding: "utf8" })
  .filter(it => it.endsWith(".svelte"))
  .map(it => path.join(directory, it));
const out = fs.mkdtempSync(path.join(os.tmpdir(), "svelte-trees-"));
// The plugin's own function, as a module of its own, with a number in the place of Base64.
const [from, to] = [plugin.indexOf("const snippedTagContentAttribute"), plugin.indexOf("function hasSnippedContent")];
fs.writeFileSync(
  `${out}/snip.cjs`,
  `let count = 0;
const stringToBase64 = () => String(count++);
${plugin.slice(from, to)}
module.exports = source => ((count = 0), { ...snipScriptAndStyleTagContent(source), count: () => count });
`,
);
const snip = require(`${out}/snip.cjs`);
const rows = [];
files.forEach((file, index) => {
  let text = fs.readFileSync(file, "utf8").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const snipped = snip(text);
  text = snipped.text.trim();
  // UTF-16 index -> byte offset
  const bytes = new Uint32Array(text.length + 1);
  for (let i = 0, b = 0; i < text.length; i++) {
    bytes[i] = b;
    const c = text.charCodeAt(i);
    b +=
      c < 0x80
        ? 1
        : c < 0x800
          ? 2
          : c >= 0xd800 && c <= 0xdbff && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff
            ? 4
            : c >= 0xdc00 &&
                c <= 0xdfff &&
                i > 0 &&
                text.charCodeAt(i - 1) >= 0xd800 &&
                text.charCodeAt(i - 1) <= 0xdbff
              ? 0
              : 3;
    bytes[i + 1] = b;
  }
  const B = i => bytes[i];
  fs.writeFileSync(
    `${out}/${index}.want.snip`,
    `{"typescript":${snipped.isTypescript},"contents":${snipped.count()}}\n` + text,
  );
  let want;
  try {
    const root = parse(text, { modern: true });
    const E = n => [B(n.start), B(n.end)];
    const P = n => {
      if (!n) return null;
      const t = n.typeAnnotation?.typeAnnotation;
      return [B(n.start), B(n.end), t ? [B(t.start), B(t.end)] : null];
    };
    const F = f => (f ? f.nodes.map(N) : null);
    const V = v => (v === true ? true : Array.isArray(v) ? v.map(N) : N(v));
    const N = n => {
      const head = [n.type, B(n.start), B(n.end)];
      switch (n.type) {
        case "Text":
          return head;
        case "Comment":
          return [...head, n.data];
        case "Attribute": {
          // `{a}`: no call of the parser.
          const isShorthand =
            !Array.isArray(n.value) &&
            n.value !== true &&
            n.value.start === n.value.expression.start &&
            text[n.start] === "{";
          if (isShorthand)
            return [
              ...head,
              n.name,
              [
                "ExpressionTag",
                B(n.value.start),
                B(n.value.end),
                [B(n.value.expression.start), B(n.value.expression.end)],
              ],
            ];
          return [...head, n.name, V(n.value)];
        }
        case "SpreadAttribute":
        case "AttachTag":
        case "ExpressionTag":
        case "HtmlTag":
        case "RenderTag":
          return [...head, E(n.expression)];
        case "StyleDirective":
          return [...head, n.name, n.modifiers, V(n.value)];
        case "UseDirective":
        case "AnimateDirective":
        case "BindDirective":
        case "ClassDirective":
        case "OnDirective":
        case "LetDirective":
        case "TransitionDirective": {
          const isName =
            n.expression &&
            n.expression.loc === undefined &&
            n.expression.type === "Identifier" &&
            n.expression.end === n.end &&
            !text.slice(n.start, n.end).includes("=");
          return [
            ...head,
            n.name,
            n.modifiers ?? [],
            n.expression ? (isName ? [B(n.expression.start), B(n.expression.end)] : E(n.expression)) : null,
          ];
        }
        case "ConstTag": {
          const d = n.declaration.declarations[0];
          return [...head, [B(d.start), B(d.end)]];
        }
        case "DeclarationTag":
          return [...head, [B(n.declaration.start), B(n.declaration.end)]];
        case "DebugTag":
          return [...head, n.identifiers.map(i => [B(i.start), B(i.end)])];
        case "IfBlock":
          return [...head, n.elseif, E(n.test), F(n.consequent), F(n.alternate)];
        case "EachBlock":
          return [
            ...head,
            E(n.expression),
            P(n.context),
            n.index ?? null,
            n.key ? E(n.key) : null,
            F(n.body),
            F(n.fallback),
          ];
        case "AwaitBlock":
          return [...head, E(n.expression), P(n.value), P(n.error), F(n.pending), F(n.then), F(n.catch)];
        case "KeyBlock":
          return [...head, E(n.expression), F(n.fragment)];
        case "SnippetBlock": {
          const last = n.parameters.at(-1);
          const end = last ? B(last.typeAnnotation?.end ?? last.end) : 0;
          return [...head, [B(n.expression.start), B(n.expression.end)], last ? end : null, F(n.body)];
        }
        case "Script":
          return [...head, n.context === "module", n.attributes.map(N)];
        case "StyleSheet":
          return [...head, n.attributes.map(N)];
        default: {
          const self = n.type === "SvelteComponent" ? n.expression : n.type === "SvelteElement" ? n.tag : null;
          // The attribute `this` was read with the others: in its place.
          const isText = self && self.type === "Literal" && self.loc === undefined;
          const attributes = n.attributes.map(N);
          return [
            ...head,
            n.name,
            attributes,
            F(n.fragment),
            self ? (isText ? [B(self.start), B(self.end)] : E(self)) : null,
          ];
        }
      }
    };
    const options = root.options
      ? [
          "SvelteOptions",
          B(root.options.start),
          B(root.options.end),
          "svelte:options",
          root.options.attributes.map(N),
          [],
          null,
        ]
      : null;
    want = [
      F(root.fragment),
      options,
      root.module ? N(root.module) : null,
      root.instance ? N(root.instance) : null,
      root.css ? N(root.css) : null,
      root.comments.map(c => [B(c.start), B(c.end), c.type === "Block"]),
    ];
  } catch (error) {
    if (error.code === undefined) throw error;
    want = { code: error.code, at: B(error.position?.[0] ?? error.start?.character ?? 0) };
  }
  fs.writeFileSync(`${out}/${index}.want.json`, JSON.stringify(want));
  rows.push(`${file}\t${out}/${index}.got`);
});
fs.writeFileSync(`${out}/list.tsv`, rows.join("\n") + "\n");
spawnSync(bin, ["format", "svelte-trees", `${out}/list.tsv`], { stdio: "inherit" });

let snipSame = 0,
  treeSame = 0,
  bothRefuse = 0,
  sameCode = 0,
  samePlace = 0;
const bad = { snip: [], tree: [], onlyWe: [], onlyThey: [], comments: [] };
const codes = new Map();
const firstDifference = (a, b, path = "") => {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = firstDifference(a[i], b[i], `${path}/${i}`);
      if (d) return d;
    }
  }
  return `${path}: want ${JSON.stringify(a)?.slice(0, 110)} got ${JSON.stringify(b)?.slice(0, 110)}`;
};
rows.forEach((row, index) => {
  const file = row.split("\t")[0];
  const read = name => {
    try {
      return fs.readFileSync(`${out}/${index}.${name}`, "utf8");
    } catch {
      return null;
    }
  };
  const [wantSnip, gotSnip, want, got] = [
    read("want.snip"),
    read("got.snip"),
    JSON.parse(read("want.json")),
    JSON.parse(read("got.json") ?? "null"),
  ];
  if (wantSnip === gotSnip) snipSame++;
  else bad.snip.push(`${index} ${file}`);
  const [weRefuse, theyRefuse] = [got && !Array.isArray(got), !Array.isArray(want)];
  if (theyRefuse && weRefuse) {
    bothRefuse++;
    if (want.code === got.code) {
      sameCode++;
      if (want.at === got.at) samePlace++;
    } else codes.set(`${want.code} <> ${got.code}`, (codes.get(`${want.code} <> ${got.code}`) ?? 0) + 1);
    return;
  }
  if (theyRefuse) return void bad.onlyThey.push(`${index} ${want.code} ${file}`);
  if (weRefuse || !got) return void bad.onlyWe.push(`${index} ${JSON.stringify(got)} ${file}`);
  const d = firstDifference(want.slice(0, 5), got.slice(0, 5));
  if (d) return void bad.tree.push(`${index} ${file}\n     ${d}`);
  treeSame++;
  const theirs = new Set(want[5].map(c => c.join()));
  if (!got[5].every(c => theirs.has(c.join()))) bad.comments.push(`${index} ${file}`);
});
console.log({
  files: rows.length,
  snipSame,
  treeSame,
  bothRefuse,
  sameCode,
  samePlace,
  snipDiffers: bad.snip.length,
  treeDiffers: bad.tree.length,
  onlyWeRefuse: bad.onlyWe.length,
  onlyTheyRefuse: bad.onlyThey.length,
  comments: bad.comments.length,
});
for (const [k, v] of Object.entries(bad)) if (v.length) console.log(`--- ${k}\n` + v.slice(0, 12).join("\n"));
console.log([...codes].sort((a, z) => z[1] - a[1]).slice(0, 15));
fs.rmSync(out, { recursive: true });
