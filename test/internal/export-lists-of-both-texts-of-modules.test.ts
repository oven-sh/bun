// A module of src/js may have two texts: `bun run` evaluates src/js/<file>, and the compiler reads src/js/ahead-of-time/<file> in its place.
// A text that asks a module for a name that the module does not export gets `undefined`, and nothing says so. So the export lists of the two
// texts are held against each other, and on each side every name that a text asks of a module is one that the module exports on that side.
import { Glob } from "bun";
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const modules = join(import.meta.dir, "../../src/js");
const read = (file: string) => readFileSync(join(modules, file), "utf8").replaceAll("\r\n", "\n");
const secondTextOf = (file: string) => "ahead-of-time/" + file;
const files = [
  ...new Set(
    [...new Glob("**/*.{js,ts}").scanSync({ cwd: modules })]
      .map(file => file.replaceAll("\\", "/").replace(/^ahead-of-time\//, ""))
      .filter(file => !file.endsWith(".d.ts")),
  ),
].sort();

// What `bun run` evaluates has these folded, and the arms that they close are gone from it.
const constants = Object.fromEntries(
  [
    ...read("../codegen/replacements.ts").matchAll(
      /\/\/ `bun compile` replaces the value.*\n((?: *"[A-Z_]+": "(?:true|false)",\n)+)/g,
    ),
  ].flatMap(([, lines]) => [...lines.matchAll(/"([A-Z_]+)": "(true|false)"/g)].map(([, name, value]) => [name, value])),
);
const printer = { loader: "ts", target: "bun", trimUnusedImports: false } as const;
const evaluated = new Bun.Transpiler({ ...printer, deadCodeElimination: true, define: constants });
const compiled = new Bun.Transpiler({ ...printer, deadCodeElimination: false });

const key = /^(?:(?:get|set|async) (?=[\w$"[])|\*)*("[^"]+"|[\w$]+)/;
const spelled = (name: string) => name.replace(/[/.$:]/g, "\\$&");

/** The keys of the object literals behind `head` at the start of a line, as the printer lays them. Undefined for a key that is computed or spread. */
function keysBehind(text: string, head: string): (string | undefined)[] {
  const literals = text.matchAll(new RegExp(`^${head}\\{(?: (.*) \\}|\\n([\\s\\S]*?)\\n\\})\\)?;?$`, "gm"));
  return [...literals].flatMap(([, line, lines]) =>
    (line?.split(", ") ?? lines.split("\n").filter(entry => /^  [^\s)}\]]/.test(entry))).map(entry =>
      key.exec(entry.trim())?.[1].replace(/^"|"$/g, ""),
    ),
  );
}

interface Text {
  printed: string;
  exports: Set<string>;
  /** The module exports these names and no other. */
  listsAllExports: boolean;
}
const texts = new Map<string, Text>();

function textOf(transpiler: Bun.Transpiler, file: string): Text {
  const known = texts.get(`${transpiler === evaluated}:${file}`);
  if (known !== undefined) return known;
  const text = transpiler.transformSync(read(file));
  const named = transpiler.scan(read(file)).exports.filter(name => name !== "default");
  const value = /^export default ([\w$.]+);?$/m.exec(text)?.[1];
  const keys =
    value === undefined
      ? keysBehind(text, "export default ")
      : [
          ...keysBehind(text, `(?:(?:const|let|var) )?${spelled(value)} = `),
          ...keysBehind(text, `Object\\.(?:assign|defineProperties)\\(${spelled(value)}, `),
          ...text
            .matchAll(
              new RegExp(
                `^(?:${spelled(value)}\\.([\\w$]+) = |Object\\.defineProperty\\(${spelled(value)}, "([^"]+)")`,
                "gm",
              ),
            )
            .map(([, stored, defined]) => stored ?? defined),
        ];
  const exports = new Set([...named, ...keys.filter(name => name !== undefined)]);
  // `export default <name>`: one literal lays the value, and the text names it nowhere else, so nothing is stored into it later.
  const isLaidOnce =
    value !== undefined &&
    keysBehind(text, `(?:(?:const|let|var) )?${spelled(value)} = `).length > 0 &&
    text.match(new RegExp(`(?<![\\w$.])${spelled(value)}(?![\\w$])`, "g"))!.length === 2;
  const listsAllExports = (value === undefined || isLaidOnce) && exports.size > 0 && !keys.includes(undefined);
  const found = { printed: text, exports, listsAllExports };
  texts.set(`${transpiler === evaluated}:${file}`, found);
  return found;
}

// What a second text leaves out on purpose. The test below holds that nothing that the compiler reads asks for one of them.
const leftOutOfSecondText: Record<string, string[]> = {
  // The second text of node:_http_server does this work in functions of its own.
  "internal/http.ts": ["callCloseCallback", "emitCloseNT"],
  // The second text of node:repl names the global object itself.
  "internal/repl/node-primordials.ts": ["globalThis"],
  // The second texts take these from internal/streams/state.
  "internal/streams/utils.ts": [
    "kOnConstructed",
    "kState",
    "kObjectMode",
    "kErrorEmitted",
    "kAutoDestroy",
    "kEmitClose",
    "kDestroyed",
    "kClosed",
    "kCloseEmitted",
    "kErrored",
    "kConstructed",
  ],
};

test("the second text of a module exports what the first exports", () => {
  const leftOut: Record<string, string[]> = {};
  const pairs = files.filter(file => existsSync(join(modules, file)) && existsSync(join(modules, secondTextOf(file))));
  expect(pairs).toContain("internal/primordials.js");
  for (const file of pairs) {
    const second = textOf(compiled, secondTextOf(file)).exports;
    const missing = [...textOf(compiled, file).exports].filter(name => !second.has(name));
    if (missing.length > 0) leftOut[file] = missing;
  }
  expect(leftOut).toEqual(leftOutOfSecondText);
});

const fileOf = (specifier: string) =>
  [".ts", ".js"]
    .map(extension => specifier.replace(/^(node|bun):/, "$1/") + extension)
    .find(file => files.includes(file));

function namesAskedInVain(transpiler: Bun.Transpiler, locate: (file: string) => string): string[] {
  const inVain: string[] = [];
  let asked = 0;
  for (const file of files.filter(file => existsSync(join(modules, locate(file))))) {
    const text = textOf(transpiler, locate(file)).printed;
    for (const specifier of new Set(text.matchAll(/\brequire\("([^"]+)"\)/g).map(([, specifier]) => specifier))) {
      const module = fileOf(specifier);
      if (module === undefined || !existsSync(join(modules, locate(module)))) continue;
      const { exports, listsAllExports } = textOf(transpiler, locate(module));
      if (!listsAllExports) continue;
      const call = `require\\("${spelled(specifier)}"\\)`;
      const wanted = [
        ...text
          .matchAll(new RegExp(`\\{([^{}]*)\\} = ${call}(?![.([])`, "g"))
          .flatMap(([, pattern]) => pattern.split(",").map(entry => entry.trim().split(/[:=]/)[0].trim())),
        ...text.matchAll(new RegExp(`${call}\\.([\\w$]+)`, "g")).map(([, name]) => name),
      ].filter(name => name !== "");
      asked += wanted.length;
      for (const name of new Set(wanted)) {
        if (!exports.has(name)) inVain.push(`${locate(file)} asks ${locate(module)} for ${name}`);
      }
    }
  }
  expect(asked).toBeGreaterThan(500);
  return inVain;
}

test("what `bun run` evaluates asks a module only for names that it exports", () => {
  expect(namesAskedInVain(evaluated, file => file)).toEqual([]);
});

test("what the compiler reads asks a module only for names that it exports", () => {
  const locate = (file: string) => (existsSync(join(modules, secondTextOf(file))) ? secondTextOf(file) : file);
  expect(namesAskedInVain(compiled, locate)).toEqual([]);
});
