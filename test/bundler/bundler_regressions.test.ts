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
  // Without splitting a source file is copied into every entry-point chunk
  // that reaches it, while the symbol merge is global. Only statements with an
  // identical clause list may merge there: merging r into p in entry2 and into
  // q in entry3 would otherwise link p's and q's `x`, and entry1, which keeps
  // both p and q, would declare that binding twice.
  itBundled("regression/ExternalImportDedupeMultiEntryNoSplitting#8671", {
    files: {
      "/entry1.js": /* js */ `
        import { p } from "./p.js";
        import { q } from "./q.js";
        console.log(p, q);
      `,
      "/entry2.js": /* js */ `
        import { p } from "./p.js";
        import { r } from "./r.js";
        console.log(p, r);
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
      { file: "/out/entry2.js", stdout: "p/ r/" },
      { file: "/out/entry3.js", stdout: "q// r/" },
    ],
    onAfterBundle(api) {
      expect(importStatements(api.readFile("/out/entry2.js"))).toEqual(['import { sep } from "ext";']);
      expect(importStatements(api.readFile("/out/entry1.js"))).toHaveLength(2);
      expect(importStatements(api.readFile("/out/entry3.js"))).toHaveLength(2);
    },
  });
  // shared.js is the kept statement in entry1's chunk and a dropped one in
  // entry2's chunk; every chunk still declares the merged binding exactly once.
  itBundled("regression/ExternalImportDedupeMultiEntryNoSplittingSharedFile#8671", {
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
      { file: "/out/entry1.js", stdout: "/ only/1" },
      { file: "/out/entry2.js", stdout: "/ only/2" },
    ],
    onAfterBundle(api) {
      for (const file of ["/out/entry1.js", "/out/entry2.js"]) {
        expect(importStatements(api.readFile(file))).toEqual(['import * as ns from "ext";']);
      }
    },
  });
  // `import { x, x as y }` binds one export to two locals. Merging b.js's
  // identical pair into the one `sep` ref recorded for a.js in entry1 would make
  // entry2, where b.js is the kept statement, declare the same local twice.
  // Such statements are left alone.
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
      // Neither statement is merged: each file keeps its own two locals.
      const entry1 = importStatements(api.readFile("/out/entry1.js"));
      expect(entry1).toHaveLength(2);
      expect(entry1[0]).toBe('import { sep, sep as sep1 } from "ext";');
      expect(entry1[1]).toMatch(/^import \{ sep as (\w+), sep as (?!\1\b)\w+ \} from "ext";$/);
      expect(importStatements(api.readFile("/out/entry2.js"))).toEqual(['import { sep, sep as sep1 } from "ext";']);
    },
  });
  // Without splitting, only statements written the same way merge, so a chunk
  // never prints a local name taken from a file it does not contain: entry2
  // keeps p.js's `path` even though entry1 merged nothing with q.js's `ext`,
  // and entry2's own `ext` is not pushed aside by a name from q.js.
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
      for (const file of ["/out/entry1.js", "/out/entry2.js"]) {
        expect([...api.readFile(file).matchAll(/from"ext"/g)]).toHaveLength(1);
      }
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
