import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun test` compiles the files that bunfig.toml's scopes name with the React Compiler. A bundle that a test makes is left as it is written, whatever the
// scopes say: a page that it serves, and what it hands to Bun.build(). react/compiler-runtime holds a mark here, which is in a bundle if a file of it was compiled.
const files = {
  "bunfig.toml": `[test]
reactCompiler = { include = ["src", "legacy"], exclude = ["legacy"] }`,
  "legacy/List.tsx": `export function List({ items }: { items: number[] }) {
  const doubled = items.map(item => item * 2);
  return <ul>{doubled.map(item => <li key={item}>{item}</li>)}</ul>;
}`,
  "legacy/ts-entry.ts": `import { useTotal } from "./useTotal.ts"; (globalThis as any).shown = useTotal([1, 2]);`,
  "legacy/ts.html": `<!doctype html><html><body><script type="module" src="./ts-entry.ts"></script></body></html>`,
  "legacy/tsx-entry.ts": `import { List } from "./List.tsx"; (globalThis as any).shown = List({ items: [1, 2] });`,
  "legacy/tsx.html": `<!doctype html><html><body><script type="module" src="./tsx-entry.ts"></script></body></html>`,
  "legacy/useTotal.ts": `import { useState } from "react";
export function useTotal(items: number[]) {
  const [factor] = useState(2);
  const scaled = items.map(item => item * factor);
  return { scaled, factor };
}`,
  "node_modules/react/compiler-runtime.js": `export const c = size => ((globalThis.asked = (globalThis.asked ?? 0) + 1), Array(size).fill("MARK-OF-THE-COMPILER-RUNTIME"));`,
  "node_modules/react/index.js": `export const useState = value => [value, () => {}];`,
  "node_modules/react/jsx.js": `export const jsxDEV = (type, props) => ({ type, props }), jsx = jsxDEV, jsxs = jsxDEV;`,
  "node_modules/react/package.json": `{ "name": "react", "version": "19.0.0", "exports": { ".": "./index.js", "./compiler-runtime": "./compiler-runtime.js", "./jsx-runtime": "./jsx.js", "./jsx-dev-runtime": "./jsx.js" } }`,
  "page.test.ts": `import { test } from "bun:test";
import includedTsx from "./src/tsx.html";
import includedTs from "./src/ts.html";
import excludedTsx from "./legacy/tsx.html";
import excludedTs from "./legacy/ts.html";
import { List as included } from "./src/List.tsx";
import { List as excluded } from "./legacy/List.tsx";

test("which files of a page's bundle went through the React Compiler", async () => {
  using server = Bun.serve({ port: 0, development: process.env.DEVELOPMENT === "1", routes: { "/a": includedTsx, "/b": includedTs, "/c": excludedTsx, "/d": excludedTs } });
  const answers: string[] = [];
  for (const [route, name] of [["/a", "included.tsx"], ["/b", "included.ts"], ["/c", "EXCLUDED.tsx"], ["/d", "EXCLUDED.ts"]]) {
    const html = await (await fetch(new URL(route, server.url))).text();
    const scripts = [...html.matchAll(/src="([^"]+\\.js[^"]*)"/g)].map(match => match[1]);
    let text = "";
    for (const script of scripts) text += await (await fetch(new URL(script, server.url))).text();
    answers.push(name + " " + (scripts.length === 0 ? "NO-SCRIPT" : text.includes("MARK-OF-THE-COMPILER-RUNTIME") ? "compiled" : "as-written"));
  }
  console.log("SAID pages: " + answers.join(" | "));
  // Bun.build() inside the test: it is given nothing about the React Compiler.
  const built: string[] = [];
  for (const [entry, name] of [["./src/tsx-entry.ts", "included.tsx"], ["./src/ts-entry.ts", "included.ts"], ["./legacy/tsx-entry.ts", "EXCLUDED.tsx"], ["./legacy/ts-entry.ts", "EXCLUDED.ts"]]) {
    const result = await Bun.build({ entrypoints: [entry], target: "browser" });
    const text = (await Promise.all(result.outputs.map(output => output.text()))).join("");
    built.push(name + " " + (!result.success || !text ? "NO-OUTPUT" : text.includes("MARK-OF-THE-COMPILER-RUNTIME") ? "compiled" : "as-written"));
  }
  console.log("SAID Bun.build: " + built.join(" | "));
  // Is the compiler on in this run at all, and does it heed the scopes for the modules that the test itself imports?
  const asks = (component: Function) => { (globalThis as any).asked = 0; component({ items: [1, 2] }); return (globalThis as any).asked > 0 ? "compiled" : "as-written"; };
  console.log("SAID modules of the test: included.tsx " + asks(included) + " | EXCLUDED.tsx " + asks(excluded));
}, 180_000);`,
  "src/List.tsx": `export function List({ items }: { items: number[] }) {
  const doubled = items.map(item => item * 2);
  return <ul>{doubled.map(item => <li key={item}>{item}</li>)}</ul>;
}`,
  "src/ts-entry.ts": `import { useTotal } from "./useTotal.ts"; (globalThis as any).shown = useTotal([1, 2]);`,
  "src/ts.html": `<!doctype html><html><body><script type="module" src="./ts-entry.ts"></script></body></html>`,
  "src/tsx-entry.ts": `import { List } from "./List.tsx"; (globalThis as any).shown = List({ items: [1, 2] });`,
  "src/tsx.html": `<!doctype html><html><body><script type="module" src="./tsx-entry.ts"></script></body></html>`,
  "src/useTotal.ts": `import { useState } from "react";
export function useTotal(items: number[]) {
  const [factor] = useState(2);
  const scaled = items.map(item => item * factor);
  return { scaled, factor };
}`,
};
const none = "included.tsx as-written | included.ts as-written | EXCLUDED.tsx as-written | EXCLUDED.ts as-written";

const forms: [string, string[], string][] = [
  ["plain", [], ""],
  ["as one program", ["--aot"], "TestRunLayers:0"],
  ["over two layers", ["--aot"], "TestRunLayers:2,TestRunPartFiles:1"],
];
const servers = [
  ["a server for production", ""],
  ["a server for development", "1"],
];

test.concurrent.each(
  forms.flatMap(([form, ...run]) =>
    servers.map(([server, development]) => [form, server, ...run, development] as const),
  ),
)("the scopes are for the modules of a test, not for its bundles: %s, %s", async (_, __, flags, words, development) => {
  using directory = tempDir("aot-react-compiler-pages", files);
  const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words, DEVELOPMENT: development };
  const { stdout, stderr } = await run([bunExe(), "test", ...flags, "./page.test.ts"], String(directory), env);
  expect((stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SAID "))).toEqual([
    "SAID pages: " + none,
    "SAID Bun.build: " + none,
    "SAID modules of the test: included.tsx compiled | EXCLUDED.tsx as-written",
  ]);
});

test("the mark shows in a bundle that is compiled", async () => {
  using directory = tempDir("aot-react-compiler-pages", files);
  await run([bunExe(), "build", "--react-compiler", "./src/tsx.html", "--outdir", "out"], String(directory), bunEnv);
  const scripts = readdirSync(join(String(directory), "out")).filter(name => name.endsWith(".js"));
  expect(scripts.map(name => readFileSync(join(String(directory), "out", name), "utf8")).join("")).toContain(
    "MARK-OF-THE-COMPILER-RUNTIME",
  );
});
