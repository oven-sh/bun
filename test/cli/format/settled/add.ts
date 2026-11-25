// Adds to `corpus.zst`. It never takes anything out, see README.md.
//
//     bun bd test/cli/format/settled/add.ts [file or directory ..]
//
// Without arguments: the inputs of ../prettier, ../oxfmt, ../own and cases.ts.
import { readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { collect, readBundle, writeBundle } from "../bundle.ts";
import { inputs } from "./cases.ts";
import { compare, optionSets } from "./run.ts";

const corpusPath = join(import.meta.dir, "corpus.zst");
const isCode = (name: string) => /\.([cm]?[jt]s|[jt]sx)$/.test(name);
const sources = new Map<string, Uint8Array>();
const paths = process.argv.slice(2);
for (const path of paths) {
  if (statSync(path).isDirectory()) collect(path, ".", sources, name => !isCode(name));
  else sources.set(path, readFileSync(path));
}
for (const name of sources.keys()) if (name.includes("/node_modules/")) sources.delete(name);
if (paths.length === 0) {
  for (const suite of ["prettier", "oxfmt"]) {
    for (const [name, bytes] of readBundle(join(import.meta.dir, "..", suite, "bundle.zst"))) {
      if (isCode(name) && !name.startsWith("flow/")) sources.set(`${suite}/${name}`, bytes);
    }
  }
  const own = new Map<string, Uint8Array>();
  collect(join(import.meta.dir, "../own"), "cases", own, name => !name.endsWith(".input"));
  for (const [name, bytes] of own) if (isCode(name.slice(0, -6))) sources.set(name.slice(0, -6), bytes);
}

const extensionOf = (name: string) => (name.endsWith(".d.ts") ? ".d.ts" : extname(name));
const named = (set: string, extension: string, text: string) =>
  `${set}/${Bun.hash.wyhash(text).toString(36)}${extension}`;
const run = (files: Map<string, string>) => compare([process.execPath], files, { wantsFormatted: true });

// Each source in the style of both tools, and of two of the other sets of options.
const [first, second, ...others] = Object.keys(optionSets);
const whole = new Map<string, string>();
for (const [name, bytes] of sources) {
  const text = Buffer.from(bytes).toString();
  const pick = Number(Bun.hash.wyhash(text) % 1000n);
  for (const set of [first, second, others[pick % others.length], others[(pick + 3) % others.length]]) {
    whole.set(named(set, extensionOf(name), text), text);
  }
}
if (paths.length === 0) {
  for (const [extension, text] of inputs) {
    for (const set in optionSets) whole.set(named(set, `.${extension}`, text), text);
  }
}

// One statement that isn't recognized would cost the file, so the statements are taken one by one. What isn't one is rejected.
const pieces = new Map<string, string>();
for (const { path, formatted } of await run(whole)) {
  if (!formatted) continue;
  const imports = /^(?:import [^]*?["'];?\n\n?)+/m.exec(formatted)?.[0] ?? "";
  const statements = formatted.split(/^(?=[^\s)\]{}>])/m);
  const withComments = formatted.split(/^(?<!^(?:\/\/.*|.*\*\/|#!.*|@.*)\n\n?)(?=[^\s)\]{}>])/m);
  for (const piece of [formatted, imports, ...statements, ...withComments]) {
    const text = piece.trimEnd() + "\n";
    if (text.length > 4 && text.length < 1200) pieces.set(named(path.split("/")[0], extensionOf(path), text), text);
  }
}

// Of the pieces that only differ in their names, the first.
const shapeOf = (path: string, text: string) =>
  path.split("/")[0] +
  extensionOf(path) +
  text.replace(/\b(?!(?:as|do|if|in|is|of|for|get|let|new|set|try|var)\b)[A-Za-z_$][\w$]{0,2}\b/g, "x").replace(/\d+/g, "1");
const corpus = readBundle(corpusPath);
const shapes = new Set([...corpus].map(([path, text]) => shapeOf(path, text.toString())));
const before = corpus.size;
for (const { verdict, formatter, path, text } of await run(pieces)) {
  const shape = shapeOf(path, text);
  if (verdict !== "Formatted" || formatter !== "keeps" || shapes.has(shape)) continue;
  shapes.add(shape);
  corpus.set(path, Buffer.from(text));
}
writeBundle(corpusPath, corpus);
console.log(`${corpus.size - before} added, ${corpus.size} in all`);
