import { describe, expect } from "bun:test";
import { readdirSync } from "node:fs";
import { itBundled } from "./expectBundled";

const extRuntime = {
  "/node_modules/ext/index.js": /* js */ `
    export const join = (...p) => p.join("/");
    export const dirname = p => p.split("/").slice(0, -1).join("/");
    export const sep = "/";
    export default { join, dirname, sep };
  `,
  "/node_modules/ext/package.json": /* json */ `{ "name": "ext", "type": "module", "main": "index.js" }`,
};

/** Top-level `import` statements of a chunk, in output order. */
const importStatements = (code: string) => code.match(/^import\b[^;]*;/gm) ?? [];

const reactRuntime = {
  "/node_modules/react/index.js": /* js */ `export const version = "19.9.9";`,
  "/node_modules/react/jsx-dev-runtime.js": /* js */ `
    export const Fragment = "Fragment";
    export const jsxDEV = (type, props) => ({ type, props });
  `,
  "/node_modules/react/package.json": /* json */ `{
    "name": "react",
    "type": "module",
    "exports": { ".": "./index.js", "./jsx-dev-runtime": "./jsx-dev-runtime.js" }
  }`,
};

/** Packages that print a line when they are evaluated. */
const loggingRuntime = (...names: string[]) =>
  Object.fromEntries(
    names.flatMap(name => [
      [
        `/node_modules/${name}/index.js`,
        `console.log("evaluating ${name}"); globalThis.${name}Loaded = "${name}"; export const v = "${name}";`,
      ],
      [`/node_modules/${name}/package.json`, `{ "name": "${name}", "type": "module", "main": "index.js" }`],
    ]),
  );

describe("bundler", () => {
  // https://github.com/oven-sh/bun/issues/8671
  // Every source file's external `import path from "node:path"` used to survive
  // into the chunk as its own `import pathN from "path"`.
  itBundled("regression/ExternalImportDedupeDefault#8671", {
    files: {
      "/entry.js": /* js */ `
        import { a } from "./a.js";
        import { b } from "./b.js";
        import { c } from "./c.js";
        console.log(a(), b(), c());
      `,
      "/a.js": /* js */ `
        import path from "node:path";
        import { shared } from "./shared.js";
        export const a = () => path.posix.join(shared, "a");
      `,
      "/b.js": /* js */ `
        import path from "node:path";
        import { shared } from "./shared.js";
        export const b = () => path.posix.join(shared, "b");
      `,
      "/c.js": /* js */ `
        import path from "node:path";
        import { shared } from "./shared.js";
        export const c = () => path.posix.join(shared, "c");
      `,
      "/shared.js": /* js */ `export const shared = "shared";`,
    },
    target: "bun",
    external: ["node:path"],
    run: { stdout: "shared/a shared/b shared/c" },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      const imports = out.match(/^import .* from "path";$/gm) ?? [];
      expect(imports).toEqual(['import path from "path";']);
      expect(out).not.toMatch(/\bpath2\b/);
    },
  });
  itBundled("regression/ExternalImportDedupeNamedAndStar#8671", {
    files: {
      "/entry.js": /* js */ `
        import { a } from "./a.js";
        import { b } from "./b.js";
        import { c } from "./c.js";
        import { d } from "./d.js";
        console.log(a(), b(), c(), d);
      `,
      "/a.js": /* js */ `
        import { join } from "ext";
        import * as ns from "ext";
        export const a = () => join(ns.sep, "a");
      `,
      "/b.js": /* js */ `
        import { join } from "ext";
        import * as ns from "ext";
        export const b = () => join(ns.sep, "b");
      `,
      // brings in a binding the earlier imports don't cover: must be kept
      "/c.js": /* js */ `
        import { dirname } from "ext";
        export const c = () => dirname("x/y");
      `,
      // bare side-effect import: second occurrence redundant
      "/d.js": /* js */ `
        import "ext";
        export const d = "d";
      `,
    },
    format: "esm",
    external: ["ext"],
    runtimeFiles: extRuntime,
    run: { stdout: "//a //b x d" },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      const importLines = (out.match(/^import .*"ext";$/gm) ?? []).sort();
      expect(importLines).toEqual([
        'import * as ns from "ext";',
        'import { dirname } from "ext";',
        'import { join } from "ext";',
      ]);
    },
  });
  // A later import that adds a new binding must be kept; its overlapping
  // bindings stay distinct so the two statements don't declare the same name.
  itBundled("regression/ExternalImportDedupePartialOverlap#8671", {
    files: {
      "/entry.js": /* js */ `
        import { a } from "./a.js";
        import { b } from "./b.js";
        import { c } from "./c.js";
        console.log(a(), b(), c());
      `,
      "/a.js": /* js */ `
        import { join } from "ext";
        export const a = () => join("x", "a");
      `,
      "/b.js": /* js */ `
        import { join, sep } from "ext";
        export const b = () => join(sep, "b");
      `,
      "/c.js": /* js */ `
        import { join } from "ext";
        export const c = () => join("x", "c");
      `,
    },
    format: "esm",
    external: ["ext"],
    runtimeFiles: extRuntime,
    run: { stdout: "x/a //b x/c" },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out.match(/^import .* from "ext";$/gm)).toEqual([
        'import { join } from "ext";',
        'import { join as join2, sep } from "ext";',
      ]);
    },
  });
  itBundled("regression/ExternalImportDedupePartialOverlapDefault#8671", {
    files: {
      "/entry.js": /* js */ `
        import { a } from "./a.js";
        import { b } from "./b.js";
        import { c } from "./c.js";
        console.log(a(), b(), c());
      `,
      "/a.js": /* js */ `
        import ext from "ext";
        export const a = () => ext.join("x", "a");
      `,
      "/b.js": /* js */ `
        import ext, { sep } from "ext";
        export const b = () => ext.join(sep, "b");
      `,
      "/c.js": /* js */ `
        import ext from "ext";
        export const c = () => ext.join("x", "c");
      `,
    },
    format: "esm",
    external: ["ext"],
    runtimeFiles: extRuntime,
    run: { stdout: "x/a //b x/c" },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out.match(/^import .* from "ext";$/gm)).toEqual([
        'import ext from "ext";',
        'import ext2, { sep } from "ext";',
      ]);
    },
  });
  itBundled("regression/ExternalImportDedupeSplitting#8671", {
    files: {
      "/entry1.js": /* js */ `
        import { a } from "./a.js";
        import { b } from "./b.js";
        console.log(a(), b());
      `,
      "/entry2.js": /* js */ `
        import { a } from "./a.js";
        import { b } from "./b.js";
        console.log(b(), a());
      `,
      "/a.js": /* js */ `
        import ext from "ext";
        export const a = () => ext.join("x", "a");
      `,
      "/b.js": /* js */ `
        import ext from "ext";
        export const b = () => ext.join("x", "b");
      `,
    },
    entryPoints: ["/entry1.js", "/entry2.js"],
    format: "esm",
    splitting: true,
    external: ["ext"],
    runtimeFiles: extRuntime,
    outdir: "/out",
    run: [
      { file: "/out/entry1.js", stdout: "x/a x/b" },
      { file: "/out/entry2.js", stdout: "x/b x/a" },
    ],
    onAfterBundle(api) {
      const chunks = readdirSync(api.outdir).filter(f => f.endsWith(".js") && f !== "entry1.js" && f !== "entry2.js");
      expect(chunks.length).toBe(1);
      const chunk = api.readFile("/out/" + chunks[0]);
      expect(chunk.match(/^import .* from "ext";$/gm) ?? []).toEqual(['import ext from "ext";']);
    },
  });
  // A second import from the same path that adds no new bindings is dropped,
  // but the import kept for the first file must keep the renamer's name for
  // the shared binding so the second file's uses still resolve.
  itBundled("regression/ExternalImportDedupeMinified#8671", {
    files: {
      "/entry.js": /* js */ `
        import { a } from "./a.js";
        import { b } from "./b.js";
        console.log(a(), b());
      `,
      "/a.js": /* js */ `
        import ext from "ext";
        export const a = () => ext.join("x", "a");
      `,
      "/b.js": /* js */ `
        import ext from "ext";
        export const b = () => ext.join("x", "b");
      `,
    },
    format: "esm",
    external: ["ext"],
    runtimeFiles: extRuntime,
    minifyIdentifiers: true,
    minifyWhitespace: true,
    run: { stdout: "x/a x/b" },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect([...out.matchAll(/from"ext"/g)]).toHaveLength(1);
    },
  });
  // compute_cross_chunk_dependencies captures both re-exported external refs
  // before this pass runs; merging them would make the entry chunk's cross-
  // chunk import declare the same local twice.
  for (const [kind, reexportingFile, join] of [
    ["Named", /* js */ `import { join as j } from "ext"; export { j };`, (binding: string) => binding],
    ["Star", /* js */ `import * as j from "ext"; export { j };`, (binding: string) => `${binding}.join`],
  ] as const) {
    itBundled(`regression/ExternalImportDedupeSplittingReexport${kind}#8671`, {
      files: {
        "/entry1.js": /* js */ `
          import { j as a } from "./a.js";
          import { j as b } from "./b.js";
          console.log(${join("a")}("x", "y"), ${join("b")}("p", "q"));
        `,
        "/entry2.js": /* js */ `
          import { j as a } from "./a.js";
          import { j as b } from "./b.js";
          console.log(${join("b")}("x", "y"), ${join("a")}("p", "q"));
        `,
        "/a.js": reexportingFile,
        "/b.js": reexportingFile,
      },
      entryPoints: ["/entry1.js", "/entry2.js"],
      format: "esm",
      splitting: true,
      external: ["ext"],
      runtimeFiles: extRuntime,
      outdir: "/out",
      run: [
        { file: "/out/entry1.js", stdout: "x/y p/q" },
        { file: "/out/entry2.js", stdout: "x/y p/q" },
      ],
    });
  }
  // The first import of a path is the one that is kept, even a bare one, so
  // the order in which the externals are evaluated is unchanged. Dropping the
  // bare import in favour of the later binding import would move "side" after
  // "other".
  itBundled("regression/ExternalImportDedupeKeepsEvaluationOrder#8671", {
    files: {
      "/entry.js": /* js */ `
        import "./a.js";
        import "./b.js";
        import "./c.js";
        console.log("entry");
      `,
      "/a.js": /* js */ `
        import "side";
        import { tag } from "other";
        console.log("a", tag);
      `,
      "/b.js": /* js */ `
        import { v } from "side";
        console.log("b", v);
      `,
      "/c.js": /* js */ `
        import "side";
        import { tag } from "other";
        console.log("c", tag);
      `,
    },
    format: "esm",
    external: ["side", "other"],
    runtimeFiles: {
      "/node_modules/side/index.js": /* js */ `console.log("evaluating side"); export const v = "V";`,
      "/node_modules/side/package.json": /* json */ `{ "name": "side", "type": "module", "main": "index.js" }`,
      "/node_modules/other/index.js": /* js */ `console.log("evaluating other"); export const tag = "O";`,
      "/node_modules/other/package.json": /* json */ `{ "name": "other", "type": "module", "main": "index.js" }`,
    },
    run: {
      stdout: `
        evaluating side
        evaluating other
        a O
        b V
        c O
        entry
      `,
    },
    onAfterBundle(api) {
      expect(importStatements(api.readFile("/out.js"))).toEqual([
        'import"side";',
        'import { tag } from "other";',
        'import { v } from "side";',
      ]);
    },
  });
  // Clause order does not matter; the same export name from a different
  // package is a different binding.
  itBundled("regression/ExternalImportDedupeClauseOrder#8671", {
    files: {
      "/entry.js": /* js */ `
        import { a } from "./a.js";
        import { b } from "./b.js";
        import { c } from "./c.js";
        console.log(a, b, c);
      `,
      "/a.js": /* js */ `
        import { join, sep } from "ext";
        export const a = join("a", sep);
      `,
      "/b.js": /* js */ `
        import { sep, join } from "ext";
        export const b = join(sep, "b");
      `,
      "/c.js": /* js */ `
        import { join } from "ext2";
        export const c = join("c");
      `,
    },
    format: "esm",
    external: ["ext", "ext2"],
    runtimeFiles: {
      ...extRuntime,
      "/node_modules/ext2/index.js": /* js */ `export const join = (...p) => "ext2:" + p.join("/");`,
      "/node_modules/ext2/package.json": /* json */ `{ "name": "ext2", "type": "module", "main": "index.js" }`,
    },
    run: { stdout: "a// //b ext2:c" },
    onAfterBundle(api) {
      expect(importStatements(api.readFile("/out.js"))).toEqual([
        'import { join, sep } from "ext";',
        'import { join as join2 } from "ext2";',
      ]);
    },
  });
  // The entry point re-exports a binding whose import statement was dropped;
  // the export clause has to print the kept statement's name.
  itBundled("regression/ExternalImportDedupeEntryReexport#8671", {
    files: {
      "/entry.js": /* js */ `
        export { joinA } from "./a.js";
        export { joinB } from "./b.js";
      `,
      "/a.js": /* js */ `import { join } from "ext"; export { join as joinA };`,
      "/b.js": /* js */ `import { join } from "ext"; export { join as joinB };`,
    },
    format: "esm",
    external: ["ext"],
    runtimeFiles: {
      ...extRuntime,
      "/consumer.js": /* js */ `
        import { joinA, joinB } from "./out.js";
        console.log(joinA("a", "1"), joinB("b", "2"), joinA === joinB);
      `,
    },
    run: { file: "/consumer.js", stdout: "a/1 b/2 true" },
    onAfterBundle(api) {
      expect(importStatements(api.readFile("/out.js"))).toEqual(['import { join } from "ext";']);
    },
  });
  // Import attributes are part of what the statement imports: the two JSON
  // imports collapse, the attribute-less one stays separate.
  itBundled("regression/ExternalImportDedupeImportAttributes#8671", {
    files: {
      "/entry.js": /* js */ `
        import { a } from "./a.js";
        import { b } from "./b.js";
        import { c } from "./c.js";
        console.log(a, b, c);
      `,
      "/a.js": /* js */ `
        import data from "pkg" with { type: "json" };
        export const a = data;
      `,
      "/b.js": /* js */ `
        import data from "pkg";
        export const b = data;
      `,
      "/c.js": /* js */ `
        import data from "pkg" with { type: "json" };
        export const c = data;
      `,
    },
    target: "bun",
    format: "esm",
    external: ["pkg"],
    onAfterBundle(api) {
      expect(importStatements(api.readFile("/out.js"))).toEqual([
        'import data from "pkg" with { type: "json" };',
        'import data2 from "pkg";',
      ]);
    },
  });
  // An `onResolve` answer of `{ path, external: true }` prints as its path
  // alone, whatever its namespace: two answers with one path are one import.
  itBundled("regression/ExternalImportDedupePluginPath#8671", {
    files: {
      "/entry.js": /* js */ `
        import { a } from "./a.js";
        import { b } from "./b.js";
        import { c } from "./c.js";
        console.log(a, b, c);
      `,
      "/a.js": /* js */ `import { join } from "virtual-a"; export const a = join("a", "1");`,
      "/b.js": /* js */ `import { join } from "virtual-b"; export const b = join("b", "2");`,
      "/c.js": /* js */ `import { join } from "virtual-c"; export const c = join("c", "3");`,
    },
    format: "esm",
    plugins(builder) {
      builder.onResolve({ filter: /^virtual-a$/ }, () => ({ path: "ext", namespace: "one", external: true }));
      builder.onResolve({ filter: /^virtual-b$/ }, () => ({ path: "ext", namespace: "two", external: true }));
      builder.onResolve({ filter: /^virtual-c$/ }, () => ({ path: "ext2", namespace: "one", external: true }));
    },
    runtimeFiles: {
      ...extRuntime,
      "/node_modules/ext2/index.js": /* js */ `export const join = (...p) => "ext2:" + p.join("/");`,
      "/node_modules/ext2/package.json": /* json */ `{ "name": "ext2", "type": "module", "main": "index.js" }`,
    },
    run: { stdout: "a/1 b/2 ext2:c/3" },
    onAfterBundle(api) {
      expect(importStatements(api.readFile("/out.js"))).toEqual([
        'import { join } from "ext";',
        'import { join as join2 } from "ext2";',
      ]);
    },
  });
  // Without splitting a source file is copied into the chunk of every entry
  // point that reaches it, while the symbol merge is bundle-wide. A statement is
  // dropped only when its file is in one chunk, so the binding it is linked to
  // is declared by a file of every chunk that prints it. p.js, q.js and r.js
  // are each in two chunks and keep their statements. entry2.js is in one: its
  // statement is dropped, whichever of p.js and r.js comes first.
  for (const [name, first, second] of [
    ["", "p", "r"],
    ["Reversed", "r", "p"],
  ] as const) {
    itBundled(`regression/ExternalImportDedupeMultiEntryNoSplitting${name}#8671`, {
      files: {
        "/entry1.js": /* js */ `
          import { p } from "./p.js";
          import { q } from "./q.js";
          console.log(p, q);
        `,
        "/entry2.js": /* js */ `
          import { ${first} } from "./${first}.js";
          import { ${second} } from "./${second}.js";
          import { sep } from "ext";
          console.log(p, r, sep);
        `,
        "/entry3.js": /* js */ `
          import { q } from "./q.js";
          import { r } from "./r.js";
          console.log(q, r);
        `,
        "/p.js": /* js */ `import { sep } from "ext"; export const p = "p" + sep;`,
        "/q.js": /* js */ `import { sep, join } from "ext"; export const q = join("q", sep);`,
        "/r.js": /* js */ `import { sep } from "ext"; export const r = "r" + sep;`,
      },
      entryPoints: ["/entry1.js", "/entry2.js", "/entry3.js"],
      format: "esm",
      splitting: false,
      external: ["ext"],
      runtimeFiles: extRuntime,
      outdir: "/out",
      run: [
        { file: "/out/entry1.js", stdout: "p/ q//" },
        { file: "/out/entry2.js", stdout: "p/ r/ /" },
        { file: "/out/entry3.js", stdout: "q// r/" },
      ],
      onAfterBundle(api) {
        expect(importStatements(api.readFile("/out/entry1.js"))).toEqual([
          'import { sep } from "ext";',
          'import { sep as sep2, join } from "ext";',
        ]);
        expect(importStatements(api.readFile("/out/entry2.js"))).toEqual([
          'import { sep } from "ext";',
          'import { sep as sep2 } from "ext";',
        ]);
        expect(importStatements(api.readFile("/out/entry3.js"))).toEqual([
          'import { sep, join } from "ext";',
          'import { sep as sep2 } from "ext";',
        ]);
      },
    });
  }
  // shared.js is in both chunks, so its statement is never dropped. only1.js is
  // in one chunk and comes after shared.js there: its statement is dropped.
  // only2.js comes first in entry2's chunk and is kept. entry1's own `ns` must
  // not collide with the import.
  itBundled("regression/ExternalImportDedupeMultiEntryNoSplittingSharedFile#8671", {
    files: {
      "/entry1.js": /* js */ `
        import { s } from "./shared.js";
        import { o1 } from "./only1.js";
        const ns = "mine";
        console.log(s, o1, ns);
      `,
      "/entry2.js": /* js */ `
        import { o2 } from "./only2.js";
        import { s } from "./shared.js";
        console.log(s, o2);
      `,
      "/shared.js": /* js */ `import * as ns from "ext"; export const s = ns.sep;`,
      "/only1.js": /* js */ `import * as ns from "ext"; export const o1 = ns.join("only", "1");`,
      "/only2.js": /* js */ `import * as ns from "ext"; export const o2 = ns.join("only", "2");`,
    },
    entryPoints: ["/entry1.js", "/entry2.js"],
    format: "esm",
    splitting: false,
    external: ["ext"],
    runtimeFiles: extRuntime,
    outdir: "/out",
    run: [
      { file: "/out/entry1.js", stdout: "/ only/1 mine" },
      { file: "/out/entry2.js", stdout: "/ only/2" },
    ],
    onAfterBundle(api) {
      expect(importStatements(api.readFile("/out/entry1.js"))).toEqual(['import * as ns from "ext";']);
      expect(importStatements(api.readFile("/out/entry2.js"))).toEqual([
        'import * as ns from "ext";',
        'import * as ns2 from "ext";',
      ]);
    },
  });
  // b.js is in both chunks and a.js in one. Linking b.js's `sep` to a.js's made
  // entry2, which has no a.js, print it under a name that nothing reserved,
  // beside its own `sep`. c.js is in one chunk: its statement is dropped.
  for (const minify of [false, true]) {
    itBundled(`regression/ExternalImportDedupeMultiEntryNoSplittingLocalCollision${minify ? "Minified" : ""}#8671`, {
      files: {
        "/entry1.js": /* js */ `
          import { a } from "./a.js";
          import { b } from "./b.js";
          import { c } from "./c.js";
          console.log(a, b, c);
        `,
        "/entry2.js": /* js */ `
          import { b } from "./b.js";
          const sep = "|";
          console.log(b, sep);
        `,
        "/a.js": /* js */ `import { sep } from "ext"; export const a = "a" + sep;`,
        "/b.js": /* js */ `import { sep } from "ext"; export const b = "b" + sep;`,
        "/c.js": /* js */ `import { sep } from "ext"; export const c = "c" + sep;`,
      },
      entryPoints: ["/entry1.js", "/entry2.js"],
      format: "esm",
      splitting: false,
      external: ["ext"],
      runtimeFiles: extRuntime,
      minifyIdentifiers: minify,
      outdir: "/out",
      run: [
        { file: "/out/entry1.js", stdout: "a/ b/ c/" },
        { file: "/out/entry2.js", stdout: "b/ |" },
      ],
      onAfterBundle(api) {
        expect(importStatements(api.readFile("/out/entry1.js"))).toHaveLength(2);
        expect(importStatements(api.readFile("/out/entry2.js"))).toHaveLength(1);
      },
    });
  }
  // r.js is in both chunks. Linking its `sep` to p.js's made entry2, which has
  // no p.js, print `rsep` as a bare `sep`, and f's own `sep` captured it.
  itBundled("regression/ExternalImportDedupeMultiEntryNoSplittingNestedScope#8671", {
    files: {
      "/entry1.js": /* js */ `
        import { p } from "./p.js";
        import { r } from "./r.js";
        console.log(p, r);
      `,
      "/entry2.js": /* js */ `
        import { r, rsep } from "./r.js";
        function f() {
          const sep = "local";
          return rsep + sep;
        }
        console.log(r, f());
      `,
      "/p.js": /* js */ `import { sep } from "ext"; export const p = "p" + sep;`,
      "/r.js": /* js */ `import { sep } from "ext"; export { sep as rsep }; export const r = "r" + sep;`,
    },
    entryPoints: ["/entry1.js", "/entry2.js"],
    format: "esm",
    splitting: false,
    external: ["ext"],
    runtimeFiles: extRuntime,
    outdir: "/out",
    run: [
      { file: "/out/entry1.js", stdout: "p/ r/" },
      { file: "/out/entry2.js", stdout: "r/ /local" },
    ],
  });
  // The same with a builtin: a main entry and a worker entry that share util.js.
  itBundled("regression/ExternalImportDedupeMultiEntryNoSplittingBuiltin#8671", {
    files: {
      "/main.js": /* js */ `
        import { h } from "./helper.js";
        import { u } from "./util.js";
        console.log(h(), u());
      `,
      "/worker.js": /* js */ `
        import { u } from "./util.js";
        const path = "/tmp/x";
        console.log(path, u());
      `,
      "/helper.js": /* js */ `import path from "node:path"; export const h = () => path.posix.join("h", "1");`,
      "/util.js": /* js */ `import path from "node:path"; export const u = () => path.posix.join("u", "1");`,
    },
    entryPoints: ["/main.js", "/worker.js"],
    target: "bun",
    format: "esm",
    splitting: false,
    outdir: "/out",
    run: [
      { file: "/out/main.js", stdout: "h/1 u/1" },
      { file: "/out/worker.js", stdout: "/tmp/x u/1" },
    ],
  });
  // The two entry points share no file, so every file is in one chunk and each
  // chunk merges as a single-entry build does.
  itBundled("regression/ExternalImportDedupeMultiEntryNoSplittingDisjoint#8671", {
    files: {
      "/entry1.js": /* js */ `
        import { a } from "./a.js";
        import { b } from "./b.js";
        console.log(a, b);
      `,
      "/entry2.js": /* js */ `
        import { c } from "./c.js";
        import { d } from "./d.js";
        console.log(c, d);
      `,
      "/a.js": /* js */ `import { sep } from "ext"; export const a = "a" + sep;`,
      "/b.js": /* js */ `import { sep } from "ext"; export const b = "b" + sep;`,
      "/c.js": /* js */ `import { sep } from "ext"; export const c = "c" + sep;`,
      "/d.js": /* js */ `import { sep } from "ext"; export const d = "d" + sep;`,
    },
    entryPoints: ["/entry1.js", "/entry2.js"],
    format: "esm",
    splitting: false,
    external: ["ext"],
    runtimeFiles: extRuntime,
    outdir: "/out",
    run: [
      { file: "/out/entry1.js", stdout: "a/ b/" },
      { file: "/out/entry2.js", stdout: "c/ d/" },
    ],
    onAfterBundle(api) {
      for (const file of ["/out/entry1.js", "/out/entry2.js"]) {
        expect(importStatements(api.readFile(file))).toEqual(['import { sep } from "ext";']);
      }
    },
  });
  // `import { x, x as y }` binds one export to two locals. b.js is in both
  // chunks, so its statement is kept beside a.js's and each file keeps its own
  // two locals.
  itBundled("regression/ExternalImportDedupeMultiEntryNoSplittingDuplicateAlias#8671", {
    files: {
      "/entry1.js": /* js */ `
        import { A } from "./a.js";
        import { B } from "./b.js";
        console.log(A, B);
      `,
      "/entry2.js": /* js */ `
        import { B } from "./b.js";
        console.log(B);
      `,
      "/a.js": /* js */ `import { sep, sep as sep1 } from "ext"; export const A = sep + sep1 + "a";`,
      "/b.js": /* js */ `import { sep, sep as sep1 } from "ext"; export const B = sep + sep1 + "b";`,
    },
    entryPoints: ["/entry1.js", "/entry2.js"],
    format: "esm",
    splitting: false,
    external: ["ext"],
    runtimeFiles: extRuntime,
    outdir: "/out",
    run: [
      { file: "/out/entry1.js", stdout: "//a //b" },
      { file: "/out/entry2.js", stdout: "//b" },
    ],
    onAfterBundle(api) {
      const entry1 = importStatements(api.readFile("/out/entry1.js"));
      expect(entry1).toHaveLength(2);
      expect(entry1[0]).toBe('import { sep, sep as sep1 } from "ext";');
      expect(entry1[1]).toMatch(/^import \{ sep as (\w+), sep as (?!\1\b)\w+ \} from "ext";$/);
      expect(importStatements(api.readFile("/out/entry2.js"))).toEqual(['import { sep, sep as sep1 } from "ext";']);
    },
  });
  // p.js is in both chunks, so entry1 keeps its statement beside q.js's. entry2
  // prints the `path` that p.js wrote, and its own `ext` is not pushed aside by
  // a name from q.js.
  itBundled("regression/ExternalImportDedupeMultiEntryNoSplittingLocalNames#8671", {
    files: {
      "/entry1.js": /* js */ `
        import { q } from "./q.js";
        import { p } from "./p.js";
        console.log(q, p);
      `,
      "/entry2.js": /* js */ `
        import { p } from "./p.js";
        const ext = "local";
        console.log(p, ext);
      `,
      "/p.js": /* js */ `import path from "ext"; export const p = path.join("p", "1");`,
      "/q.js": /* js */ `import ext from "ext"; export const q = ext.join("q", "1");`,
    },
    entryPoints: ["/entry1.js", "/entry2.js"],
    format: "esm",
    splitting: false,
    external: ["ext"],
    runtimeFiles: extRuntime,
    outdir: "/out",
    run: [
      { file: "/out/entry1.js", stdout: "q/1 p/1" },
      { file: "/out/entry2.js", stdout: "p/1 local" },
    ],
    onAfterBundle(api) {
      expect(importStatements(api.readFile("/out/entry1.js"))).toEqual([
        'import ext from "ext";',
        'import path from "ext";',
      ]);
      const entry2 = api.readFile("/out/entry2.js");
      expect(importStatements(entry2)).toEqual(['import path from "ext";']);
      expect(entry2).toMatch(/\b(?:var|let|const) ext = "local"/);
    },
  });
  itBundled("regression/ExternalImportDedupeMultiEntryNoSplittingMinified#8671", {
    files: {
      "/entry1.js": /* js */ `
        import { s } from "./shared.js";
        import { o1 } from "./only1.js";
        console.log(s, o1);
      `,
      "/entry2.js": /* js */ `
        import { o2 } from "./only2.js";
        import { s } from "./shared.js";
        console.log(s, o2);
      `,
      "/shared.js": /* js */ `import { join, sep } from "ext"; export const s = join("s", sep);`,
      "/only1.js": /* js */ `import { join, sep } from "ext"; export const o1 = join("o1", sep);`,
      "/only2.js": /* js */ `import { join, sep } from "ext"; export const o2 = join("o2", sep);`,
    },
    entryPoints: ["/entry1.js", "/entry2.js"],
    format: "esm",
    splitting: false,
    external: ["ext"],
    runtimeFiles: extRuntime,
    minifyIdentifiers: true,
    minifyWhitespace: true,
    outdir: "/out",
    run: [
      { file: "/out/entry1.js", stdout: "s// o1//" },
      { file: "/out/entry2.js", stdout: "s// o2//" },
    ],
    onAfterBundle(api) {
      expect([...api.readFile("/out/entry1.js").matchAll(/from"ext"/g)]).toHaveLength(1);
      expect([...api.readFile("/out/entry2.js").matchAll(/from"ext"/g)]).toHaveLength(2);
    },
  });
  // A default import and `{ default as x }` bind the same export through two
  // different clause slots; the pass does not try to unify them.
  itBundled("regression/ExternalImportDedupeDefaultViaNamedClause#8671", {
    files: {
      "/entry.js": /* js */ `
        import { a } from "./a.js";
        import { b } from "./b.js";
        console.log(a, b);
      `,
      "/a.js": /* js */ `import ext from "ext"; export const a = ext.sep;`,
      "/b.js": /* js */ `import { default as ext } from "ext"; export const b = ext.sep;`,
    },
    format: "esm",
    external: ["ext"],
    runtimeFiles: extRuntime,
    run: { stdout: "/ /" },
    onAfterBundle(api) {
      expect(importStatements(api.readFile("/out.js"))).toEqual([
        'import ext from "ext";',
        'import { default as ext2 } from "ext";',
      ]);
    },
  });
  // b.js's statement and c.js's bare import are dropped: the code after them
  // moves up, and its mappings have to move with it.
  itBundled("regression/ExternalImportDedupeSourceMap#8671", {
    files: {
      "/entry.js": [
        'import { a } from "./a.js";',
        'import { b } from "./b.js";',
        'import { c } from "./c.js";',
        "console.log(a(), b(), c());",
      ].join("\n"),
      "/a.js": ['import { join } from "ext";', 'export const a = () => join("a", "1");'].join("\n"),
      "/b.js": ['import { join } from "ext";', 'export const b = () => join("b", "2");'].join("\n"),
      "/c.js": ['import "ext";', 'import { join, sep } from "ext";', 'export const c = () => join("c", sep);'].join(
        "\n",
      ),
    },
    format: "esm",
    external: ["ext"],
    runtimeFiles: extRuntime,
    outdir: "/out",
    sourceMap: "external",
    run: { file: "/out/entry.js", stdout: "a/1 b/2 c//" },
    onAfterBundle(api) {
      expect(importStatements(api.readFile("/out/entry.js"))).toEqual([
        'import { join } from "ext";',
        'import { join as join2, sep } from "ext";',
      ]);
    },
    snapshotSourceMap: {
      "entry.js.map": {
        files: ["../a.js", "../b.js", "../c.js", "../entry.js"],
        mappings: [
          ["a.js:2:'join'", "3:14:join"],
          ["b.js:2:'join'", "6:14:join"],
          ["c.js:3:'join'", "10:14:join2"],
          ["c.js:3:'sep'", "10:25:sep"],
          ["entry.js:4:'console'", "13:0:console"],
        ],
      },
    },
  });
  // Code that a direct `eval` runs names the bindings of its file, so a.js and
  // b.js keep their statements. c.js has no `eval`: its statement is dropped.
  itBundled("regression/ExternalImportDedupeDirectEval#8671", {
    files: {
      "/entry.js": /* js */ `
        import { a } from "./a.js";
        import { b } from "./b.js";
        import { c } from "./c.js";
        console.log(a(), b(), c());
      `,
      "/a.js": /* js */ `import { join as j1 } from "ext"; export const a = () => eval("j1('a', '1')");`,
      "/b.js": /* js */ `import { join as j2 } from "ext"; export const b = () => eval("j2('b', '2')");`,
      "/c.js": /* js */ `import { join as j3 } from "ext"; export const c = () => j3("c", "3");`,
    },
    format: "esm",
    external: ["ext"],
    runtimeFiles: extRuntime,
    run: { stdout: "a/1 b/2 c/3" },
    onAfterBundle(api) {
      expect(importStatements(api.readFile("/out.js"))).toEqual([
        'import { join as j1 } from "ext";',
        'import { join as j2 } from "ext";',
      ]);
    },
  });
  // The key is the export, not the local name: b.js's `join`, `sep`,
  // `classNames` and `ns` print under the names a.js chose, and b.js's nested
  // `j` and `n` do not capture them.
  for (const minify of [false, true]) {
    itBundled(`regression/ExternalImportDedupeDifferentLocalNames${minify ? "Minified" : ""}#8671`, {
      files: {
        "/entry.js": /* js */ `
          import { a } from "./a.js";
          import { b } from "./b.js";
          console.log(a, b);
        `,
        "/a.js": /* js */ `
          import { join as j, sep as s } from "ext";
          import cx from "ext";
          import * as n from "ext";
          export const a = j("a", s) + cx.sep + n.sep;
        `,
        "/b.js": /* js */ `
          import { join, sep } from "ext";
          import classNames from "ext";
          import * as ns from "ext";
          const nested = (j, n) => join("b", j, n);
          export const b = nested(sep, "x") + classNames.sep + ns.sep;
        `,
      },
      format: "esm",
      external: ["ext"],
      runtimeFiles: extRuntime,
      minifyIdentifiers: minify,
      run: { stdout: "a//// b///x//" },
      onAfterBundle(api) {
        const imports = importStatements(api.readFile("/out.js"));
        if (minify) expect(imports).toHaveLength(3);
        else
          expect(imports).toEqual([
            'import { join as j, sep as s } from "ext";',
            'import cx from "ext";',
            'import * as n from "ext";',
          ]);
      },
    });
  }
  // b.js's `extJoin` and `extSep` print as a.js's `join` and `sep`. The nested
  // `join` and `sep` of b.js would capture them, so they are numbered, and
  // their `name` changes with them.
  itBundled("regression/ExternalImportDedupeNestedBindingName#8671", {
    files: {
      "/entry.js": /* js */ `
        import { a } from "./a.js";
        import { makeJoin, Box } from "./b.js";
        console.log(a, makeJoin()("b", "1"), new (Box())().v, makeJoin().name, Box().name);
      `,
      "/a.js": /* js */ `import { join, sep } from "ext"; export const a = join("a", sep);`,
      "/b.js": /* js */ `
        import { join as extJoin, sep as extSep } from "ext";
        export function makeJoin() { function join(...p) { return extJoin(...p); } return join; }
        export function Box() { class sep { v = extSep; } return sep; }
      `,
    },
    format: "esm",
    external: ["ext"],
    runtimeFiles: extRuntime,
    run: { stdout: "a// b/1 / join2 sep2" },
    onAfterBundle(api) {
      expect(importStatements(api.readFile("/out.js"))).toEqual(['import { join, sep } from "ext";']);
    },
  });
  // `var React = require("react")` in a CommonJS file prints as `import * as
  // React`. It merges like a written import.
  for (const minify of [false, true]) {
    itBundled(`regression/ExternalImportDedupeLiftedRequire${minify ? "Minified" : ""}#8671`, {
      files: {
        "/entry.js": /* js */ `
          import w1 from "w1";
          import w2 from "w2";
          import * as R from "react";
          console.log(w1(), w2(), R.version);
        `,
        "/node_modules/w1/index.js": /* js */ `
          var React = require("react");
          module.exports = function w1() { return "w1:" + React.version; };
        `,
        "/node_modules/w1/package.json": /* json */ `{ "name": "w1", "main": "index.js" }`,
        "/node_modules/w2/index.js": /* js */ `
          var React = require("react");
          module.exports = function w2() { return "w2:" + React.version; };
        `,
        "/node_modules/w2/package.json": /* json */ `{ "name": "w2", "main": "index.js" }`,
      },
      format: "esm",
      external: ["react"],
      runtimeFiles: reactRuntime,
      minifyIdentifiers: minify,
      run: { stdout: "w1:19.9.9 w2:19.9.9 19.9.9" },
      onAfterBundle(api) {
        expect(importStatements(api.readFile("/out.js"))).toHaveLength(1);
      },
    });
  }
  // With a direct `eval` in its file, the `var` of a lifted `require()` cannot
  // be renamed. Linking it would give its name to the kept binding, so its
  // statement stays.
  itBundled("regression/ExternalImportDedupeLiftedRequireDirectEval#8671", {
    files: {
      "/entry.js": /* js */ `
        import w1 from "w1";
        import lib from "lib";
        console.log(w1(), lib());
      `,
      "/node_modules/w1/index.js": /* js */ `
        var React = require("react");
        module.exports = function w1() { return "w1:" + React.version; };
      `,
      "/node_modules/w1/package.json": /* json */ `{ "name": "w1", "main": "index.js" }`,
      "/node_modules/lib/index.js": /* js */ `
        var ReactLib = require("react");
        var two = eval("1 + 1");
        module.exports = function lib() { return "lib:" + eval("ReactLib.version") + ":" + two; };
      `,
      "/node_modules/lib/package.json": /* json */ `{ "name": "lib", "main": "index.js" }`,
    },
    format: "esm",
    external: ["react"],
    runtimeFiles: reactRuntime,
    run: { stdout: "w1:19.9.9 lib:19.9.9:2" },
    onAfterBundle(api) {
      expect(importStatements(api.readFile("/out.js"))).toEqual([
        'import * as React from "react";',
        'import * as ReactLib from "react";',
      ]);
    },
  });
  // w1 is in both chunks. lib and lib3 are each in one chunk and pin `React`
  // with a direct `eval`. Linking them to w1's `React` declared it twice in
  // the chunk of the other entry point.
  itBundled("regression/ExternalImportDedupeMultiEntryNoSplittingPinnedName#8671", {
    files: {
      "/entry1.js": /* js */ `
        import w1 from "w1";
        import lib from "lib";
        console.log(w1(), lib());
      `,
      "/entry2.js": /* js */ `
        import lib3 from "lib3";
        import w1 from "w1";
        console.log(lib3(), w1());
      `,
      "/node_modules/w1/index.js": /* js */ `
        var React = require("react");
        module.exports = function w1() { return "w1:" + React.version; };
      `,
      "/node_modules/w1/package.json": /* json */ `{ "name": "w1", "main": "index.js" }`,
      "/node_modules/lib/index.js": /* js */ `
        var React = require("react");
        var two = eval("1 + 1");
        module.exports = function lib() { return "lib:" + React.version + ":" + two; };
      `,
      "/node_modules/lib/package.json": /* json */ `{ "name": "lib", "main": "index.js" }`,
      "/node_modules/lib3/index.js": /* js */ `
        var React = require("react");
        var three = eval("1 + 2");
        module.exports = function lib3() { return "lib3:" + React.version + ":" + three; };
      `,
      "/node_modules/lib3/package.json": /* json */ `{ "name": "lib3", "main": "index.js" }`,
    },
    entryPoints: ["/entry1.js", "/entry2.js"],
    format: "esm",
    splitting: false,
    external: ["react"],
    runtimeFiles: reactRuntime,
    outdir: "/out",
    run: [
      { file: "/out/entry1.js", stdout: "w1:19.9.9 lib:19.9.9:2" },
      { file: "/out/entry2.js", stdout: "lib3:19.9.9:3 w1:19.9.9" },
    ],
  });
  // A wrapped file is printed before the files that import it, and its imports
  // are hoisted out of the wrapper. The kept statement of a path is the first
  // one in that print order, so the externals are evaluated as without the pass.
  // esm.js's hoisted statement is dropped, and its own `cv` does not capture
  // the kept `cv`.
  itBundled("regression/ExternalImportDedupeEvaluationOrderWrappedFiles#8671", {
    files: {
      "/entry.js": /* js */ `
        import "./a.js";
        import cjs from "./cjs.js";
        const lazy = () => require("./esm.js");
        console.log("entry", cjs.v, lazy().e);
      `,
      "/a.js": /* js */ `
        import "other";
        import { v } from "side";
        import "third";
        console.log("a", v);
      `,
      "/cjs.js": /* js */ `
        import { v as cv } from "side";
        import "third";
        module.exports = { v: cv };
      `,
      "/esm.js": /* js */ `
        import "third";
        import { v } from "side";
        import "other";
        export const e = (cv => "e:" + v + cv)("!");
      `,
    },
    target: "bun",
    format: "esm",
    external: ["side", "other", "third"],
    runtimeFiles: loggingRuntime("side", "other", "third"),
    run: {
      stdout: `
        evaluating side
        evaluating third
        evaluating other
        a side
        entry side e:side!
      `,
    },
    onAfterBundle(api) {
      expect(importStatements(api.readFile("/out.js"))).toEqual([
        'import { v as cv } from "side";',
        'import"third";',
        'import"other";',
      ]);
    },
  });
  // a.ts uses `Options` as a type only, so its statement is not printed and is
  // not the kept one. b.ts's statement is.
  itBundled("regression/ExternalImportDedupeTypeOnlyFirstImporter#8671", {
    files: {
      "/entry.ts": /* ts */ `
        import { a } from "./a";
        import { b } from "./b";
        import { c } from "./c";
        console.log(a, b("x"), c("y"));
      `,
      "/a.ts": /* ts */ `import { Options, join } from "ext"; export const a: Options = "a"; export type J = typeof join;`,
      "/b.ts": /* ts */ `import { join } from "ext"; export const b = (x: string) => join("b", x);`,
      "/c.ts": /* ts */ `import { join } from "ext"; export const c = (x: string) => join("c", x);`,
    },
    format: "esm",
    external: ["ext"],
    runtimeFiles: extRuntime,
    run: { stdout: "a b/x c/y" },
    onAfterBundle(api) {
      expect(importStatements(api.readFile("/out.js"))).toEqual(['import { join } from "ext";']);
    },
  });
  // esm.js is loaded by `require()`, so it is wrapped and its import is hoisted
  // out of the wrapper. That hoisted statement merges with the entry point's.
  itBundled("regression/ExternalImportDedupeRequiredESModule#8671", {
    files: {
      "/entry.js": /* js */ `
        import { join } from "ext";
        const lazy = () => require("./esm.js");
        console.log(join("e", "1"), lazy().v);
      `,
      "/esm.js": /* js */ `import { join } from "ext"; export const v = join("esm", "2");`,
    },
    target: "bun",
    format: "esm",
    external: ["ext"],
    runtimeFiles: extRuntime,
    run: { stdout: "e/1 esm/2" },
    onAfterBundle(api) {
      expect(importStatements(api.readFile("/out.js"))).toEqual(['import { join } from "ext";']);
    },
  });
  // `import defer` does not evaluate the module, so it is not the kept
  // statement of its path: the bare import after it stays.
  itBundled("regression/ExternalImportDedupeImportDefer#8671", {
    files: {
      "/entry.js": /* js */ `
        import { a } from "./a.js";
        import "./b.js";
        console.log(typeof a);
      `,
      "/a.js": /* js */ `import defer * as ns from "side"; export const a = () => ns.v;`,
      "/b.js": /* js */ `import "side";`,
    },
    format: "esm",
    external: ["side"],
    onAfterBundle(api) {
      expect(importStatements(api.readFile("/out.js"))).toEqual(['import defer * as ns from "side";', 'import"side";']);
    },
  });
  // a.js is wrapped, and its unused import is in a part that is not printed.
  // It is not the kept statement: b.js's is.
  itBundled("regression/ExternalImportDedupeDeadPartInWrappedFile#8671", {
    files: {
      "/entry.js": /* js */ `
        import { b } from "./b.js";
        const a = require("./a.js");
        console.log(a.a, b);
      `,
      "/a.js": /* js */ `import path from "node:path"; export const a = 1;`,
      "/b.js": /* js */ `import path from "node:path"; export const b = path.posix.join("b", "1");`,
    },
    target: "bun",
    format: "esm",
    run: { stdout: "1 b/1" },
    onAfterBundle(api) {
      expect(importStatements(api.readFile("/out.js"))).toEqual(['import path from "path";']);
    },
  });
  // An import of "bun" prints as a read of `globalThis.Bun` in each file. The
  // pass leaves it alone.
  itBundled("regression/ExternalImportDedupeBunImport#8671", {
    files: {
      "/entry.js": /* js */ `
        import { a } from "./a.js";
        import { b } from "./b.js";
        console.log(a, b);
      `,
      "/a.js": /* js */ `import { version } from "bun"; export const a = typeof version;`,
      "/b.js": /* js */ `import { version } from "bun"; export const b = typeof version;`,
    },
    target: "bun",
    format: "esm",
    run: { stdout: "string string" },
    onAfterBundle(api) {
      expect(importStatements(api.readFile("/out.js"))).toEqual([]);
    },
  });
  // The automatic JSX runtime import is generated in each file. The two
  // `jsxDEV` statements merge.
  itBundled("regression/ExternalImportDedupeJSXRuntime#8671", {
    files: {
      "/entry.jsx": /* jsx */ `
        import { A } from "./a.jsx";
        import { B } from "./b.jsx";
        console.log(JSON.stringify([<A />, <B />].map(e => e.type(e.props))));
      `,
      "/a.jsx": /* jsx */ `export const A = () => <div />;`,
      "/b.jsx": /* jsx */ `export const B = () => <span>{1}</span>;`,
    },
    format: "esm",
    external: ["react"],
    jsx: { runtime: "automatic", development: true },
    runtimeFiles: reactRuntime,
    run: { stdout: '[{"type":"div","props":{}},{"type":"span","props":{"children":1}}]' },
    onAfterBundle(api) {
      expect(importStatements(api.readFile("/out.js"))).toEqual(['import { jsxDEV } from "react/jsx-dev-runtime";']);
    },
  });
  // b.jsx also needs `Fragment`, so its statement adds a binding and stays
  // whole: its `jsxDEV` is a second binding.
  itBundled("regression/ExternalImportDedupeJSXRuntimeFragment#8671", {
    files: {
      "/entry.js": /* js */ `
        import { A } from "./a.jsx";
        import { B } from "./b.jsx";
        console.log(A().type, B().type, B().props.children.type);
      `,
      "/a.jsx": /* jsx */ `export const A = () => <div />;`,
      "/b.jsx": /* jsx */ `export const B = () => <><span /></>;`,
    },
    format: "esm",
    external: ["react"],
    jsx: { runtime: "automatic", development: true },
    runtimeFiles: reactRuntime,
    run: { stdout: "div Fragment span" },
    onAfterBundle(api) {
      expect(importStatements(api.readFile("/out.js"))).toEqual([
        'import { jsxDEV } from "react/jsx-dev-runtime";',
        'import { jsxDEV as jsxDEV2, Fragment } from "react/jsx-dev-runtime";',
      ]);
    },
  });
  // A re-export of an external prints an import too. The pass reads `import`
  // statements only, so these print as without it.
  itBundled("regression/ExternalImportDedupeReexportsUnchanged#8671", {
    files: {
      "/entry.js": /* js */ `
        import { join as ja } from "./a.js";
        import { ns as nb } from "./b.js";
        import { c } from "./c.js";
        console.log(ja("a", "1"), nb.sep, c);
      `,
      "/a.js": /* js */ `export { join } from "ext";`,
      "/b.js": /* js */ `export * as ns from "ext";`,
      "/c.js": /* js */ `
        import { join } from "ext";
        import * as ns from "ext";
        export const c = join("c", ns.sep);
      `,
    },
    format: "esm",
    external: ["ext"],
    runtimeFiles: extRuntime,
    run: { stdout: "a/1 / c//" },
    onAfterBundle(api) {
      expect(importStatements(api.readFile("/out.js"))).toEqual([
        'import { join } from "ext";',
        'import * as ns from "ext";',
        'import { join as join2 } from "ext";',
        'import * as ns2 from "ext";',
      ]);
    },
  });
  // page2.js has its own `jsxDEV` and `jsx`. shared.jsx is in both chunks and
  // keeps its generated import, so page2's names do not collide with it.
  itBundled("regression/ExternalImportDedupeMultiEntryNoSplittingJSXRuntime#8671", {
    files: {
      "/page1.js": /* js */ `
        import { Only } from "./only1.jsx";
        import { Shared } from "./shared.jsx";
        console.log("p1", Only().type, Shared().type);
      `,
      "/page2.js": /* js */ `
        import { Shared } from "./shared.jsx";
        const jsxDEV = "mineDEV", jsx = "mine";
        console.log("p2", Shared().type, jsxDEV, jsx);
      `,
      "/only1.jsx": /* jsx */ `export const Only = () => <b>only</b>;`,
      "/shared.jsx": /* jsx */ `export const Shared = () => <i>shared</i>;`,
    },
    entryPoints: ["/page1.js", "/page2.js"],
    format: "esm",
    splitting: false,
    external: ["react"],
    jsx: { runtime: "automatic", development: true },
    runtimeFiles: reactRuntime,
    outdir: "/out",
    run: [
      { file: "/out/page1.js", stdout: "p1 b i" },
      { file: "/out/page2.js", stdout: "p2 i mineDEV mine" },
    ],
  });
  // With splitting, each chunk merges on its own: the files of entry1 alone,
  // the files of entry2 alone, and the files that both share.
  itBundled("regression/ExternalImportDedupeSplittingPerChunk#8671", {
    files: {
      "/entry1.js": /* js */ `
        import { a } from "./a.js";
        import { a2 } from "./a2.js";
        import { s } from "./shared.js";
        import { s2 } from "./shared2.js";
        console.log(a(), a2(), s(), s2());
      `,
      "/entry2.js": /* js */ `
        import { s2 } from "./shared2.js";
        import { s } from "./shared.js";
        import { b } from "./b.js";
        import { join } from "ext";
        console.log(s2(), s(), b(), join("e2", "1"));
      `,
      "/a.js": /* js */ `import { join } from "ext"; export const a = () => join("a", "1");`,
      "/a2.js": /* js */ `import { join } from "ext"; export const a2 = () => join("a2", "1");`,
      "/b.js": /* js */ `import { join } from "ext"; export const b = () => join("b", "1");`,
      "/shared.js": /* js */ `import { join } from "ext"; export const s = () => join("s", "1");`,
      "/shared2.js": /* js */ `import { join } from "ext"; export const s2 = () => join("s2", "1");`,
    },
    entryPoints: ["/entry1.js", "/entry2.js"],
    format: "esm",
    splitting: true,
    external: ["ext"],
    runtimeFiles: extRuntime,
    outdir: "/out",
    run: [
      { file: "/out/entry1.js", stdout: "a/1 a2/1 s/1 s2/1" },
      { file: "/out/entry2.js", stdout: "s2/1 s/1 b/1 e2/1" },
    ],
    onAfterBundle(api) {
      for (const file of readdirSync(api.outdir).filter(f => f.endsWith(".js"))) {
        const fromExt = importStatements(api.readFile("/out/" + file)).filter(s => s.endsWith('from "ext";'));
        expect(fromExt).toEqual(['import { join } from "ext";']);
      }
    },
  });
  // a.js's `j` is the kept binding, and the entry points import it from the
  // shared chunk. c.js's statement is dropped and links to it.
  for (const minify of [false, true]) {
    itBundled(`regression/ExternalImportDedupeSplittingKeptRefCrossesChunks${minify ? "Minified" : ""}#8671`, {
      files: {
        "/entry1.js": /* js */ `
          import { j } from "./a.js";
          import { c } from "./c.js";
          console.log(j("x", "y"), c());
        `,
        "/entry2.js": /* js */ `
          import { c } from "./c.js";
          import { j } from "./a.js";
          console.log(c(), j("p", "q"));
        `,
        "/a.js": /* js */ `import { join as j } from "ext"; export { j };`,
        "/c.js": /* js */ `import { join } from "ext"; export const c = () => join("c", "1");`,
      },
      entryPoints: ["/entry1.js", "/entry2.js"],
      format: "esm",
      splitting: true,
      external: ["ext"],
      runtimeFiles: extRuntime,
      minifyIdentifiers: minify,
      outdir: "/out",
      run: [
        { file: "/out/entry1.js", stdout: "x/y c/1" },
        { file: "/out/entry2.js", stdout: "c/1 p/q" },
      ],
      onAfterBundle(api) {
        const shared = readdirSync(api.outdir).filter(f => f.endsWith(".js") && f !== "entry1.js" && f !== "entry2.js");
        expect(shared).toHaveLength(1);
        expect(importStatements(api.readFile("/out/" + shared[0])).filter(s => s.includes('"ext"'))).toHaveLength(1);
      },
    });
  }
  // One file can repeat a path: the repeats merge with the first statements.
  // `f`'s own `ns` does not capture the kept `ns`.
  itBundled("regression/ExternalImportDedupeSameFile#8671", {
    files: {
      "/entry.js": /* js */ `
        import { join } from "ext";
        import { join as j2, sep } from "ext";
        import { join as j3 } from "ext";
        import * as ns from "ext";
        import * as ns2 from "ext";
        import def from "ext";
        import def2 from "ext";
        import "ext";
        const f = ns => ns + ns2.sep;
        console.log(join("a", "b"), j2("c", sep), j3("d", "e"), ns.sep, f("x"), def.sep, def2.sep);
      `,
    },
    format: "esm",
    external: ["ext"],
    runtimeFiles: extRuntime,
    run: { stdout: "a/b c// d/e / x/ / /" },
    onAfterBundle(api) {
      expect(importStatements(api.readFile("/out.js"))).toEqual([
        'import { join } from "ext";',
        'import { join as j2, sep } from "ext";',
        'import * as ns from "ext";',
        'import def from "ext";',
      ]);
    },
  });
  // shared.js is in both chunks, so it keeps its own repeats, with another
  // importer before it in one chunk only.
  itBundled("regression/ExternalImportDedupeMultiEntryNoSplittingSameFile#8671", {
    files: {
      "/entry1.js": /* js */ `
        import { s } from "./shared.js";
        console.log(s);
      `,
      "/entry2.js": /* js */ `
        import { p } from "./p.js";
        import { s } from "./shared.js";
        console.log(p, s);
      `,
      "/p.js": /* js */ `
        import { join } from "ext";
        import * as ns from "ext";
        export const p = join("p", ns.sep);
      `,
      "/shared.js": /* js */ `
        import { join } from "ext";
        import { join as j3 } from "ext";
        import * as ns from "ext";
        import * as ns2 from "ext";
        export const s = [join("a", "b"), j3("c", "d"), ns.sep, ns2.sep].join(" ");
      `,
    },
    entryPoints: ["/entry1.js", "/entry2.js"],
    format: "esm",
    splitting: false,
    external: ["ext"],
    runtimeFiles: extRuntime,
    outdir: "/out",
    run: [
      { file: "/out/entry1.js", stdout: "a/b c/d / /" },
      { file: "/out/entry2.js", stdout: "p// a/b c/d / /" },
    ],
    onAfterBundle(api) {
      expect(importStatements(api.readFile("/out/entry1.js"))).toHaveLength(4);
      expect(importStatements(api.readFile("/out/entry2.js"))).toHaveLength(6);
    },
  });
  // shared.js is in both chunks and imports a.js between its two statements.
  // It keeps both, also in entry2's chunk, where a.js is printed first.
  itBundled("regression/ExternalImportDedupeMultiEntryNoSplittingSameFileSplit#8671", {
    files: {
      "/entry1.js": /* js */ `
        import { s } from "./shared.js";
        console.log(s);
      `,
      "/entry2.js": /* js */ `
        import { a } from "./a.js";
        import { s } from "./shared.js";
        console.log(a, s);
      `,
      "/a.js": /* js */ `import { sep } from "ext"; export const a = "a" + sep;`,
      "/shared.js": /* js */ `
        import { join } from "ext";
        import { a } from "./a.js";
        import { join as j3 } from "ext";
        export const s = join("x", a) + " " + j3("y", a);
      `,
    },
    entryPoints: ["/entry1.js", "/entry2.js"],
    format: "esm",
    splitting: false,
    external: ["ext"],
    runtimeFiles: extRuntime,
    outdir: "/out",
    run: [
      { file: "/out/entry1.js", stdout: "x/a/ y/a/" },
      { file: "/out/entry2.js", stdout: "a/ x/a/ y/a/" },
    ],
    onAfterBundle(api) {
      for (const file of ["/out/entry1.js", "/out/entry2.js"]) {
        expect(importStatements(api.readFile(file))).toHaveLength(3);
      }
    },
  });
  // A bare import binds nothing, so it is dropped per chunk, also in a file
  // that is in both chunks: entry1 imports "side" through a.js first, and
  // entry2 has only shared.js's bare import.
  itBundled("regression/ExternalImportDedupeMultiEntryNoSplittingBareImport#8671", {
    files: {
      "/entry1.js": /* js */ `
        import { a } from "./a.js";
        import { s } from "./shared.js";
        console.log("entry1", a, s);
      `,
      "/entry2.js": /* js */ `
        import { s } from "./shared.js";
        console.log("entry2", s);
      `,
      "/a.js": /* js */ `import { v } from "side"; export const a = "a:" + v;`,
      "/shared.js": /* js */ `import "side"; export const s = "shared:" + globalThis.sideLoaded;`,
    },
    entryPoints: ["/entry1.js", "/entry2.js"],
    format: "esm",
    splitting: false,
    external: ["side"],
    runtimeFiles: loggingRuntime("side"),
    outdir: "/out",
    run: [
      { file: "/out/entry1.js", stdout: "evaluating side\nentry1 a:side shared:side" },
      { file: "/out/entry2.js", stdout: "evaluating side\nentry2 shared:side" },
    ],
    onAfterBundle(api) {
      expect(importStatements(api.readFile("/out/entry1.js"))).toEqual(['import { v } from "side";']);
      expect(importStatements(api.readFile("/out/entry2.js"))).toEqual(['import"side";']);
    },
  });
  // The dropped statements are found in the order deep.js, a.js, entry.js, and
  // are looked up by source file: the list has to be sorted.
  itBundled("regression/ExternalImportDedupeDropsInImportChain#8671", {
    files: {
      "/entry.js": /* js */ `
        import { a } from "./a.js";
        import { join } from "ext";
        console.log(a, join("e", "1"));
      `,
      "/a.js": /* js */ `
        import { deep } from "./deep.js";
        import { join } from "ext";
        export const a = deep + " " + join("a", "1");
      `,
      "/deep.js": /* js */ `
        import { sep } from "ext";
        import { join } from "ext";
        import { join as j2 } from "ext";
        export const deep = j2("deep", "1") + join(sep, "2");
      `,
    },
    format: "esm",
    external: ["ext"],
    runtimeFiles: extRuntime,
    run: { stdout: "deep/1//2 a/1 e/1" },
    onAfterBundle(api) {
      expect(importStatements(api.readFile("/out.js"))).toEqual([
        'import { sep } from "ext";',
        'import { join } from "ext";',
      ]);
    },
  });

  // Exercises the bundler's chunking/linking internals end-to-end: code
  // splitting produces cross-chunk imports (sorted deterministically), CSS is
  // compiled into its own chunk, symbols are renamed across chunks, and every
  // output is content-hashed. Keeps that machinery covered after the types that
  // back it were relocated across the bundler crate.
  itBundled("regression/SplittingWithSharedChunkAndCSS", {
    files: {
      "/entry.js": /* js */ `
        import "./styles.css";
        const { shared } = await import("./shared.js");
        const { a } = await import("./a.js");
        const { b } = await import("./b.js");
        console.log(shared(), a(), b());
      `,
      "/shared.js": /* js */ `
        export function shared() { return "shared"; }
      `,
      "/a.js": /* js */ `
        import { shared } from "./shared.js";
        export function a() { return shared() + "-a"; }
      `,
      "/b.js": /* js */ `
        import { shared } from "./shared.js";
        export function b() { return shared() + "-b"; }
      `,
      "/styles.css": `.x { color: red; }`,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    format: "esm",
    run: {
      file: "/out/entry.js",
      stdout: "shared shared-a shared-b",
    },
  });

  // https://x.com/jeroendotdot/status/1740651288239460384?s=46&t=0Uhw6mmGT650_9M2pXUsCw
  itBundled("regression/PublicPathCLIFlagNotWorking", {
    files: {
      "/entry.js": `
      import foo from './1.png';
      if (!foo.startsWith("https://example.com/foo")) {
        throw new Error("Unexpected public path: " + foo);
      }
      `,
      "/1.png": "abcdefgh",
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    publicPath: "https://example.com/foo",

    run: {
      file: "/out/entry.js",
    },
  });

  // https://github.com/oven-sh/bun/issues/2946
  itBundled("regression/InvalidIdentifierInFileName#2946", {
    files: {
      "/entry.js": "import foo from './1.png';\nconsole.log(foo);",
      "/1.png": "abcdefgh",
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    run: {
      file: "/out/entry.js",
    },
  });

  itBundled("regression/MergeAdjacentDecl#2942", {
    files: {
      "/shared.js": `
      // Current version.
      export var VERSION = '1.13.6';
      
      // Establish the root object, \`window\` (\`self\`) in the browser, \`global\`
      // on the server, or \`this\` in some virtual machines. We use \`self\`
      // instead of \`window\` for \`WebWorker\` support.
      export var root = (typeof self == 'object' && self.self === self && self) ||
                (typeof global == 'object' && global.global === global && global) ||
                Function('return this')() ||
                {};
      
      // Save bytes in the minified (but not gzipped) version:
      export var ArrayProto = Array.prototype, ObjProto = Object.prototype;
      export var SymbolProto = typeof Symbol !== 'undefined' ? Symbol.prototype : null;
      
      // Create quick reference variables for speed access to core prototypes.
      export var push = ArrayProto.push,
          slice = ArrayProto.slice,
          toString = ObjProto.toString,
          hasOwnProperty = ObjProto.hasOwnProperty;
      
      // Modern feature detection.
      export var supportsArrayBuffer = typeof ArrayBuffer !== 'undefined',
          supportsDataView = typeof DataView !== 'undefined';
      
      // All **ECMAScript 5+** native function implementations that we hope to use
      // are declared here.
      export var nativeIsArray = Array.isArray,
          nativeKeys = Object.keys,
          nativeCreate = Object.create,
          nativeIsView = supportsArrayBuffer && ArrayBuffer.isView;
      
      // Create references to these builtin functions because we override them.
      export var _isNaN = isNaN,
          _isFinite = isFinite;
      
      // Keys in IE < 9 that won't be iterated by \`for key in ...\` and thus missed.
      export var hasEnumBug = !{toString: null}.propertyIsEnumerable('toString');
      export var nonEnumerableProps = ['valueOf', 'isPrototypeOf', 'toString',
        'propertyIsEnumerable', 'hasOwnProperty', 'toLocaleString'];
      
      // The largest integer that can be represented exactly.
      export var MAX_ARRAY_INDEX = Math.pow(2, 53) - 1;
      
      `,
      // This was a race condition, so we want to add a lot of files to maximize the chances of hitting it
      "/a.js": "import * as ABC from './shared.js';; console.log(ABC);",
      "/b.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/c.js": "import * as ABC from './shared.js';; console.log(ABC);",
      "/d.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/e.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/g.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/h.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/i.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/j.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/k.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/l.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/m.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/n.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/a_1.js": "import * as ABC from './shared.js';; console.log(ABC);",
      "/a_2.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/a_3.js": "import * as ABC from './shared.js';; console.log(ABC);",
      "/a_4.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/a_5.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/a_6.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/a_7.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/a_8.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/a_9.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/a_10.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/a_11.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/a_12.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/a_13.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/b_1.js": "import * as ABC from './shared.js';; console.log(ABC);",
      "/b_2.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/b_3.js": "import * as ABC from './shared.js';; console.log(ABC);",
      "/b_4.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/b_5.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/b_6.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/b_7.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/b_8.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/b_9.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/b_10.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/b_11.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/b_12.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/b_13.js": "import * as ABC from './shared.js'; console.log(ABC);",
    },
    minifySyntax: true,

    entryPoints: [
      "/a.js",
      "/b.js",
      "/c.js",
      "/d.js",
      "/e.js",
      "/g.js",
      "/h.js",
      "/i.js",
      "/j.js",
      "/k.js",
      "/l.js",
      "/m.js",
      "/n.js",
      "/a_1.js",
      "/a_2.js",
      "/a_3.js",
      "/a_4.js",
      "/a_5.js",
      "/a_6.js",
      "/a_7.js",
      "/a_8.js",
      "/a_9.js",
      "/a_10.js",
      "/a_11.js",
      "/a_12.js",
      "/a_13.js",
      "/b_1.js",
      "/b_2.js",
      "/b_3.js",
      "/b_4.js",
      "/b_5.js",
      "/b_6.js",
      "/b_7.js",
      "/b_8.js",
      "/b_9.js",
      "/b_10.js",
      "/b_11.js",
      "/b_12.js",
      "/b_13.js",
    ],
  });

  // https://github.com/oven-sh/bun/issues/2948
  itBundled("regression/ReassignLocal#2948", {
    files: {
      "/entry.js": `
      import { Buffer } from 'node:buffer';

      export function schemaEncode(data) {
        const filename_len = Buffer.byteLength(data.filename);
        const buf = Buffer.allocUnsafe(29 + filename_len);
        buf.writeUInt8(1);
        for (let i=0; i<3; i++) buf.writeUInt32LE(data.to[i], 1 + i * 4);
        buf.writeDoubleLE(data.random, 13);
        buf.writeUInt16LE(data.page, 21);
        let offset = 23;
        offset = buf.writeUInt16LE(filename_len, offset);
        offset += buf.write(data.filename, offset);
        buf.writeUInt32LE(data.from, offset);
        return buf;
      }

      schemaEncode({filename: "heyyyy", to: [1,2,3], page: 123, random: Math.random(), from: 158})
      `,
    },
    minifySyntax: true,
    target: "bun",
    run: {
      file: "/entry.js",
    },
  });

  // https://github.com/oven-sh/bun/issues/3660
  itBundled("regression/StringDecoder#3660", {
    files: {
      "/entry.js": `
        import { StringDecoder } from 'string_decoder'

        const decoder = new StringDecoder('utf8')
        const buf = Buffer.from([0xe4, 0xbd, 0xa0, 0xe5, 0xa5, 0xbd])
        const str = decoder.write(buf)

        console.log(str)
      `,
    },
    run: { stdout: "你好" },
  });

  itBundled("regression/WindowsBackslashAssertion1#9974", {
    backend: "cli",
    files: {
      "/test/entry.ts": `
        import { loadFonts } from "../base";
        console.log(loadFonts);
      `,
    },
    entryPointsRaw: ["test/entry.ts", "--external", "*"],
  });

  itBundled(`regression/NODE_PATHBuild cli`, {
    files: {
      "/entry.js": `
        import MyClass from 'MyClass';
        console.log(new MyClass().constructor.name);
      `,
      "/src/MyClass.js": `
        export default class MyClass {}
      `,
    },
    entryPoints: ["/entry.js"],
    backend: "cli",
    env: {
      NODE_PATH: "{{root}}/src",
    },
    run: {
      stdout: "MyClass",
    },
  });

  itBundled("regression/NamespaceTracking#12337", {
    files: {
      "/entry.ts": /* ts */ `
        (0, eval)('globalThis.ca' + 'pture = () => {};')

        export namespace Test {
          export function anInstance(): Test {
            return {
              level1: {
                level2: {
                  level3: Level1.Level2.Level3.anInstance(),
                }
              },
            }
          }
 
          export namespace Level1 {
            export namespace Level2 {
              export function anInstance(): Level2 {
                return {
                  level3: Level3.anInstance(),
                }
              }
              export enum Enum {
                Value = 1,
              }
              export namespace Level3 {
                export type Value = Level3['value']
                export function anInstance(): Level3 {
                  return {
                    value: 'Hello, World!',
                  }
                }
                capture(Enum.Value);
              }
            }
            capture(Level2.Enum.Value);
          }
        }

        if(Test.anInstance().level1.level2.level3.value !== 'Hello, World!')
          throw new Error('fail')

        capture(Test.Level1.Level2.Enum.Value);
      `,
    },
    run: true,
    capture: ["1 /* Value */", "1 /* Value */", "1 /* Value */"],
  });
});
