// A CommonJS module object carries the function that loads: `require.main.require`, `module.children[0].require`, `module.constructor._load`. A program comes by that function on roads on which nobody
// writes its name: the values of the object, a rest pattern, a key that is put together, a copy, a proxy, a child, a parent. The last roads lead to other built-ins in the same way.
// The executable does what plain Bun does, or the load is refused by the error that the page documents. It never ends the process: twice in one night a change of the compiler turned a dozen of these roads
// from that error into an abort.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Road = {
  road: string;
  loads: "x" | "shelf" | undefined;
  text: string;
  head?: string[];
  beside?: Record<string, string>;
};

// The file that the road loads is in the executable: a load that never runs names it, or the program has loaded it before.
const loaded = {
  x: { "x.cjs": `console.log("x ran");\nmodule.exports = 1;\n` },
  shelf: { "shelf.cjs": `exports.label = "shelf";\n` },
};
const namesTheFile = `if (process.argv.length > 99) require("./x.cjs");\n`;

const roads: Road[] = [
  {
    road: "the-values-of-the-main-module",
    loads: "x",
    text: `Object.values(require.main).find(value => typeof value === "function" && value.length === 1 && value.name.length === 7)("./x.cjs");
`,
    head: ["Exit code: 1"],
  },
  {
    road: "a-rest-pattern",
    loads: "x",
    text: `const { id, ...rest } = require.main;
rest.require("./x.cjs");
`,
  },
  {
    road: "reflect-get-under-a-made-name",
    loads: "x",
    text: `Reflect.get(require.main, ["re", "quire"].join(""))("./x.cjs");
`,
  },
  {
    road: "a-for-in-loop",
    loads: "x",
    text: `for (const key in require.main) { const value = require.main[key]; if (typeof value === "function" && key.length === 7) value.call(require.main, "./x.cjs"); }
`,
  },
  {
    road: "the-replacer-of-json",
    loads: "x",
    text: `JSON.stringify(require.main, (key, value) => { if (typeof value === "function" && key.length === 7) value("./x.cjs"); return key === "" ? value : undefined; });
`,
  },
  {
    road: "the-entries",
    loads: "x",
    text: `Object.entries(process.mainModule).forEach(([key, value]) => { if (key.length === 7 && typeof value === "function") value("./x.cjs"); });
`,
  },
  {
    road: "the-constructor-and-load",
    loads: "x",
    text: `require.main.constructor._load("./x.cjs", require.main);
`,
    head: ["Exit code: 1"],
  },
  {
    road: "off-the-prototype",
    loads: "x",
    text: `const above = Object.getPrototypeOf(require.main);
console.log(typeof above.require);
if (typeof above.require === "function") above.require.call(require.main, "./x.cjs");
`,
  },
  {
    road: "under-a-with",
    loads: "x",
    text: `with (require.main) { require("./x.cjs"); }
`,
  },
  {
    road: "a-copy-by-assign",
    loads: "x",
    text: `const copy = Object.assign({}, require.main);
copy[Object.keys(copy).find(key => key.startsWith("req"))]("./x.cjs");
`,
  },
  {
    road: "a-function-of-another-file",
    loads: "x",
    text: `require("./helper.cjs")(require.main);
`,
    beside: {
      "helper.cjs": `module.exports = given => given.require("./x.cjs");
`,
    },
  },
  {
    road: "a-proxy-over-it",
    loads: "x",
    text: `new Proxy(require.main, {}).require("./x.cjs");
`,
  },
  {
    road: "a-child",
    loads: "x",
    text: `require("./child.cjs");
module.children[0].require("./x.cjs");
`,
    beside: {
      "child.cjs": `module.exports = 2;
`,
    },
  },
  {
    road: "through-a-list-under-a-parsed-index",
    loads: "x",
    text: `const list = [require.main];
list[JSON.parse("0")].require("./x.cjs");
`,
  },
  {
    road: "kept-in-an-object-nobody-follows",
    loads: "x",
    text: `const holder = JSON.parse("{}");
holder.kept = process.mainModule;
holder.kept.require("./x.cjs");
`,
  },
  {
    road: "the-descriptors",
    loads: "x",
    text: `Object.getOwnPropertyDescriptors(require.main)[["re", "quire"].join("")].value("./x.cjs");
`,
  },
  {
    road: "a-spread",
    loads: "x",
    text: `const copy = { ...require.main };
Object.values(copy).filter(value => typeof value === "function" && value.name.length === 7).forEach(load => load("./x.cjs"));
`,
  },
  {
    road: "compile-under-a-made-name",
    loads: "x",
    text: `const text = "console.log(\\"text ran\\")";
try { Reflect.get(require.main, ["_com", "pile"].join("")).call(require.main, text, __filename); } catch (error) { console.log(error.constructor.name); }
`,
  },
  {
    road: "the-main-of-the-require-of-it",
    loads: "x",
    text: `require.main.require.main.require("./x.cjs");
`,
  },
  {
    road: "the-parent-of-a-child",
    loads: "x",
    text: `require("./child.cjs");
`,
    head: ["Exit code: 1"],
    beside: {
      "child.cjs": `const up = [module.parent][JSON.parse("0")];
Object.values(up).find(value => typeof value === "function" && value.name.length === 7)("./x.cjs");
`,
    },
  },
  {
    road: "printed-and-nothing-else",
    loads: "x",
    text: `console.log(typeof require.main, Object.keys(require.main).length > 3);
`,
  },
  {
    road: "the-readers-values",
    loads: "shelf",
    text: `const first = require("./shelf.cjs");
const load = Object.values(require.main).find(part => typeof part === "function");
console.log(load("./shelf.cjs") === first, first.label);
`,
  },
  {
    road: "the-readers-entries",
    loads: "shelf",
    text: `const first = require("./shelf.cjs");
const load = Object.entries(process.mainModule).find(([, part]) => typeof part === "function")[1];
console.log(load("./shelf.cjs") === first, first.label);
`,
  },
  {
    road: "the-readers-replacer",
    loads: "shelf",
    text: `const first = require("./shelf.cjs");
let load; JSON.stringify(require.main, (key, value) => (typeof value === "function" && (load = value), key === "" ? value : undefined));
console.log(load("./shelf.cjs") === first, first.label);
`,
  },
  {
    road: "the-readers-reflect-get",
    loads: "shelf",
    text: `const first = require("./shelf.cjs");
const load = Reflect.get(require.main, ["req", "uire"].join(""));
console.log(load("./shelf.cjs") === first, first.label);
`,
  },
  {
    road: "names-out-of-a-list-in-another-body",
    loads: "shelf",
    text: `const first = require("./shelf.cjs");
const wanted = ["exports", "require"];
function take(holder, names) { return names.map(name => holder[name]); }
const load = take(require.main, wanted)[1];
console.log(load("./shelf.cjs") === first);
`,
  },
  {
    road: "the-species-handed-to-a-function",
    loads: undefined,
    text: `function lengthOf(Maker) { return Maker.from("hi").length; }
console.log(lengthOf(Buffer.prototype[Symbol.species]));
`,
  },
  {
    road: "the-species-or-buffer-itself",
    loads: undefined,
    text: `function lengthOf(Maker) { return Maker.from("hi").length; }
console.log(lengthOf(process.argv.length > 9 ? Buffer.prototype[Symbol.species] : Buffer));
`,
  },
  {
    road: "a-store-through-the-species",
    loads: undefined,
    text: `function patch(Maker) { Maker.isBuffer = () => "patched"; }
patch(Buffer.prototype[Symbol.species]);
console.log(Buffer.isBuffer(1));
`,
    head: ["Refused: Cannot assign to Buffer.isBuffer because built-in objects are read-only"],
  },
  {
    road: "the-signal-of-abort-controller",
    loads: undefined,
    text: `function make(S) { return S.abort().aborted; }
console.log(make(require("abort-controller").AbortSignal));
`,
  },
];

export default function write(folder: string) {
  for (const { road, loads, text, head = [], beside = {} } of roads) {
    mkdirSync(join(folder, road));
    const heads = [...head, "Refused: Cannot load '"].map(line => `// ${line}\n`).join("");
    const files = {
      "main.cjs": heads + (loads === "x" ? namesTheFile : "") + text,
      ...(loads ? loaded[loads] : {}),
      ...beside,
    };
    for (const [name, content] of Object.entries(files)) writeFileSync(join(folder, road, name), content);
  }
}
