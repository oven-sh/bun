// Components' variables as svelte-eslint-parser 1.9.0's scope manager has them. js-parsers.test.ts compares what a
// JavaScript plugin rule sees of them in `bun lint` (its `sourceCode`'s `scopesOf`) with svelte-scopes.expected.json,
// on `cases` and on the components in svelte-scopes.witnesses.json. The expected file is svelte-eslint-parser's output,
// recorded by:
//
//   node test/cli/lint/oracle/svelte-scopes.mjs <a node_modules with svelte-eslint-parser 1.9.0, svelte 5 and @typescript-eslint/parser>
//
// A variable is `name@place`, where `place` is where its first definition is named, or for one without definitions
// where its scope's block starts, and `#n` for the n-th variable after the first with that key (a class's name inside
// its class). Each has its definitions `[type, name, node, parent]` and its references `[name, start, end, "r" | "w" |
// "rw"]`, in order. A node is `[type, start, end]` or `null`. Positions are byte offsets in the file. Global-scope
// variables that nothing defines (globals, TypeScript's library) are left out, and so are the references to identifiers
// that svelte-eslint-parser synthesizes for directive types, which aren't in its tree.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const here = path.dirname(new URL(import.meta.url).pathname);

// Components, each named for what it contains.
export const cases = {
  "stores.svelte":
    "<script>\nimport { writable } from 'svelte/store';\nconst count = writable(0);\nconst only = writable(0);\nlet el;\n$count = 1;\n$count += 1;\nconst a = $count;\nfunction f() { $count = 2; $only = 3; }\n</script>\n{$count}{a}<div bind:this={$el}></div><button on:click={f}>x</button>\n",
  "reactive.svelte":
    "<script>\nlet input = 0, obj = {};\n$: x = input;\n$: x = input + 1;\n$: ({ a, b } = obj);\n$: y += 1;\n$: if (input) z = 1;\nfunction g() { x = 2; return $x + y; }\n</script>\n{x}{a}{b}{y}<button on:click={g}>x</button>\n",
  "props.svelte":
    '<script context="module">\nexport let m = 1;\n</script>\n<script>\nlet value = 1;\nexport { value };\nexport let a, { b, c: [d = 1] } = {};\nexport const k = 1;\nfunction fn() {}\nexport { fn as other, value as again };\n</script>\n{value}{a}{b}{d}{k}{m}\n',
  "runes-props.svelte":
    "<script>\nlet { x = $bindable(), y, z: { w = $bindable(1) } = {}, ...rest } = $props();\nexport const s = $state(0);\nlet t = $state(1);\n</script>\n{x}{y}{w}{rest}{s}{t}\n",
  "template.svelte":
    "<script>\nlet items = [], p, list = [];\n</script>\n{#each items as { id, name }, i (id)}{@const label = name + i}{label}{/each}\n{#each list as item}{item}{:else}none{/each}\n{#await p then value}{value}{:catch error}{error}{/await}\n{#await p}...{:then}done{/await}\n<C let:item={thing}>{thing}</C>\n<C let:other>{other}</C>\n{#snippet row(r, n = 1)}{r}{n}{arguments.length}{/snippet}\n{@render row(1)}\n<Comp>{#snippet given()}x{/snippet}</Comp>\n<Comp>{#snippet used()}y{/snippet}{@render used()}</Comp>\n{#if items}{@const one = 1}{one}{:else if p}{@const two = 2}{two}{/if}\n",
  "classes.svelte":
    "<script>\nclass C { m() { return C; } }\nconst D = class E { n() { return E; } };\nfunction h() { try { return arguments.length; } catch (e) { return e; } }\nconst arrow = () => 1;\n</script>\n{new C()}{D}{h()}{arrow()}\n",
  "order.svelte":
    "<script lang=\"ts\" generics=\"T extends typeof el\">\nimport { writable } from 'svelte/store';\nimport Dialog from './Dialog.svelte';\nimport Avatar from './Avatar.svelte';\nconst el = writable(null);\n</script>\n<div><Avatar /><div><Avatar /></div></div>\n{#snippet row()}\n<Dialog.Root><Dialog.Title>{$el}</Dialog.Title></Dialog.Root>\n{/snippet}\n<Dialog.Root>\n<Dialog.Content><Dialog.Title onclick={() => $el.remove()} /></Dialog.Content>\n{#if el}<Dialog.Close />{/if}\n</Dialog.Root>\n<div bind:this={$el}></div>\n{@render row()}\n",
};

/** The byte offsets for `text`'s UTF-16 offsets. */
function bytesOf(text) {
  const offsets = new Uint32Array(text.length + 1);
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    offsets[i] = bytes;
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code < 0xdc00) {
      offsets[i + 1] = bytes;
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  offsets[text.length] = bytes;
  return offsets;
}

function keyed(entries) {
  const out = {};
  for (const [key, value] of entries) {
    let name = key;
    for (let n = 1; name in out; n++) name = `${key}#${n}`;
    out[name] = value;
  }
  return out;
}

/** What svelte-eslint-parser's scope manager has, of `parsed` (`parseForESLint`) of `text`, whose byte order mark ESLint took
 * off before. `isVirtual`: whether a reference whose identifier is not in the tree is one that svelte-eslint-parser adds, as a
 * prop that is written where it is exported. */
export function scopesOf(parsed, text, hasBom, isVirtual = reference => reference.svelteVirtualReference) {
  const offsets = bytesOf(text);
  // svelte-eslint-parser synthesizes types for directives, whose references are to identifiers that aren't in its tree.
  const inTree = new Set();
  const walk = node => {
    if (!node || typeof node.type !== "string" || inTree.has(node)) return;
    inTree.add(node);
    for (const key of parsed.visitorKeys[node.type] ?? []) [node[key]].flat().forEach(walk);
  };
  walk(parsed.ast);
  const at = index => offsets[index] + (hasBom ? 3 : 0);
  const node = it => (it ? [it.type, at(it.range[0]), at(it.range[1])] : null);
  const entries = [];
  for (const scope of parsed.scopeManager.scopes) {
    for (const variable of scope.variables) {
      if (scope.type === "global" && variable.defs.length === 0) continue;
      const first = variable.defs[0]?.name;
      const place = first ? at(first.range[0]) : at(scope.block.range[0]);
      const defs = variable.defs.map(def => [def.type, at(def.name.range[0]), node(def.node), node(def.parent)]);
      const seen = variable.references.filter(it => inTree.has(it.identifier) || isVirtual(it));
      const references = seen.map(it => [
        it.identifier.name,
        at(it.identifier.range[0]),
        at(it.identifier.range[0]) + Buffer.byteLength(it.identifier.name),
        (it.isRead() ? "r" : "") + (it.isWrite() ? "w" : ""),
      ]);
      entries.push([`${variable.name}@${place}`, { defs, references }]);
    }
  }
  return keyed(entries);
}

/** The differences between `actual` and `expected`, each `[key, what, actual, expected]`. */
export function differences(actual, expected) {
  const out = [];
  for (const key of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
    const [a, b] = [actual[key], expected[key]];
    if (!a || !b) out.push([key, "variable", a ?? null, b ?? null]);
    else {
      if (JSON.stringify(a.defs) !== JSON.stringify(b.defs)) out.push([key, "defs", a.defs, b.defs]);
      if (JSON.stringify(a.references) !== JSON.stringify(b.references))
        out.push([key, "references", a.references, b.references]);
    }
  }
  return out;
}

/** svelte-eslint-parser's options for the test: TypeScript in every script. */
export function parse(modules, text, filePath) {
  const require = createRequire(path.join(modules, "package.json"));
  const parser = require("svelte-eslint-parser");
  const ts = require("@typescript-eslint/parser");
  const hasBom = text.startsWith("﻿");
  const stripped = hasBom ? text.slice(1) : text;
  const parsed = parser.parseForESLint(stripped, {
    filePath,
    parser: ts,
    project: false,
    ecmaVersion: 2024,
    sourceType: "module",
  });
  return scopesOf(parsed, stripped, hasBom);
}

if (import.meta.main ?? process.argv[1] === new URL(import.meta.url).pathname) {
  const [modules] = process.argv.slice(2);
  const witnesses = JSON.parse(fs.readFileSync(path.join(here, "svelte-scopes.witnesses.json"), "utf8"));
  const all = { ...cases, ...witnesses };
  const expected = {};
  for (const [name, text] of Object.entries(all)) {
    try {
      expected[name] = parse(modules, text, path.join("/project", name));
    } catch (error) {
      expected[name] = { error: String(error.message) };
    }
  }
  fs.writeFileSync(path.join(here, "svelte-scopes.expected.json"), JSON.stringify(expected));
}
