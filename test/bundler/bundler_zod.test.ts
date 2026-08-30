// Bundler integration for the zod transform: `bun build --zod-compiler`,
// `Bun.build({ zodCompiler: true })`, or BUN_FEATURE_FLAG_EXPERIMENTAL_ZOD.
// The runtime-transpiler path and full differential coverage live in
// test/bundler/transpiler/zod-transform.test.ts.
import { itBundled, testForFile, type BundlerTestInput } from "./expectBundled";
var { expect } = testForFile(import.meta.path);

const transformBasic: BundlerTestInput = {
  install: ["zod@4.4.3"],
  target: "bun",
  files: {
    "/entry.ts": /* ts */ `
      import { z } from "zod";
      const User = z.object({
        name: z.string().min(1),
        age: z.number().int().optional(),
        tags: z.array(z.string()).default([]),
      });
      console.log(JSON.stringify(User.parse({ name: "alice", age: 3, extra: 1 })));
      console.log(User.safeParse({ name: "" }).success);
      console.log(User.safeParse({ name: "" }).error.issues[0].code);
    `,
  },
  run: {
    stdout: '{"name":"alice","age":3,"tags":[]}\nfalse\ntoo_small',
  },
  onAfterBundle(api) {
    const code = api.readFile("/out.js");
    expect(code).toContain("__zod(() =>");
    expect(code).toContain('"k":"obj"');
    // The nested schema calls are absorbed into one wrapper.
    expect(code.split("__zod(() =>").length - 1).toBe(1);
  },
};

itBundled("zod/TransformBasic", {
  ...transformBasic,
  backend: "cli",
  zodCompiler: true,
});

itBundled("zod/TransformBasicViaApi", {
  ...transformBasic,
  backend: "api",
  zodCompiler: true,
});

itBundled("zod/TransformBasicViaEnvironmentVariable", {
  ...transformBasic,
  backend: "cli",
  env: { BUN_FEATURE_FLAG_EXPERIMENTAL_ZOD: "1" },
});

itBundled("zod/NoTransformWithoutFlag", {
  install: ["zod@4.4.3"],
  backend: "cli",
  target: "bun",
  files: {
    "/entry.ts": /* ts */ `
      import { z } from "zod";
      const S = z.object({ a: z.string() });
      console.log(S.parse({ a: "x" }).a);
    `,
  },
  run: { stdout: "x" },
  onAfterBundle(api) {
    // zod itself contains identifiers like __zod_globalConfig; only the
    // wrapper call shape matters.
    expect(api.readFile("/out.js")).not.toContain("__zod(() =>");
  },
});

itBundled("zod/ImpureArgumentBailsOut", {
  install: ["zod@4.4.3"],
  backend: "cli",
  zodCompiler: true,
  target: "bun",
  files: {
    "/entry.ts": /* ts */ `
      import { z } from "zod";
      import { LIMIT } from "./limits.ts";
      function limit() { return 2; }
      // A call expression as a check argument is not provably pure, so this
      // schema must be left untransformed.
      const S = z.string().min(limit());
      console.log(S.safeParse("a").success, S.safeParse("abc").success);
      // Impure args in positions the IR does not consume must also bail:
      // zero-arg check params, simple ctor params, and mode-method args.
      function msg() { return { message: "m" }; }
      const P = z.number().positive(msg());
      console.log(P.safeParse(1).success);
      const U = z.any(msg());
      console.log(U.safeParse(1).success);
      const O = z.string().optional(msg());
      console.log(O.safeParse(undefined).success);
      // A reassignable binding is not a stable capture; the schema stays untransformed.
      let mut = 2;
      const L = z.string().min(mut);
      console.log(L.safeParse("ab").success);
      // Imports are live bindings; they bail too.
      const I = z.string().min(LIMIT);
      console.log(I.safeParse("ab").success);
      // A pure sibling still transforms.
      const T = z.string().min(2);
      console.log(T.safeParse("abc").success);
    `,
    "/limits.ts": /* ts */ `
      export const LIMIT = 2;
    `,
  },
  run: { stdout: "false true\ntrue\ntrue\ntrue\ntrue\ntrue\ntrue" },
  onAfterBundle(api) {
    const code = api.readFile("/out.js");
    expect(code).toContain("min(limit())");
    expect(code).toContain("positive(msg())");
    expect(code).toContain("any(msg())");
    expect(code).toContain("optional(msg())");
    expect(code).toContain("min(mut)");
    expect(code.split("__zod(() =>").length - 1).toBe(1);
  },
});

itBundled("zod/OpaqueChildAbsorbedIntoParent", {
  install: ["zod@4.4.3"],
  backend: "cli",
  zodCompiler: true,
  target: "bun",
  files: {
    "/entry.ts": /* ts */ `
      import { z } from "zod";
      // .email() has no compiled fast path; it dissolves into the parent
      // wrapper as an opaque IR node while the rest of the object compiles.
      const S = z.object({ id: z.string(), e: z.email().optional() });
      console.log(S.safeParse({ id: "1" }).success);
      console.log(S.safeParse({ id: "1", e: "a@b.com" }).success);
      console.log(S.safeParse({ id: "1", e: "nope" }).success);
    `,
  },
  run: { stdout: "true\ntrue\nfalse" },
  onAfterBundle(api) {
    const code = api.readFile("/out.js");
    // One wrapper: the opaque .email() child is absorbed as an "opq" IR node
    // that delegates the parent's parse when reached.
    expect(code.split("__zod(() =>").length - 1).toBe(1);
    expect(code).toContain('"k":"opq"');
  },
});

itBundled("zod/DescribeBailsOut", {
  install: ["zod@4.4.3"],
  backend: "cli",
  zodCompiler: true,
  target: "bun",
  files: {
    "/entry.ts": /* ts */ `
      import { z } from "zod";
      // .describe() writes to zod's global registry at construction time, so
      // the whole expression stays untransformed.
      const S = z.string().describe("docs");
      console.log(S.description);
      console.log(S.parse("ok"));
    `,
  },
  run: { stdout: "docs\nok" },
  onAfterBundle(api) {
    expect(api.readFile("/out.js")).not.toContain("__zod(");
  },
});

itBundled("zod/NamespaceImport", {
  install: ["zod@4.4.3"],
  backend: "cli",
  zodCompiler: true,
  target: "bun",
  files: {
    "/entry.ts": /* ts */ `
      import * as z from "zod";
      const S = z.union([z.literal("a"), z.number().int()]);
      console.log(S.parse("a"), S.parse(3), S.safeParse(1.5).success);
    `,
  },
  run: { stdout: "a 3 false" },
  onAfterBundle(api) {
    expect(api.readFile("/out.js")).toContain("__zod(() =>");
  },
});

itBundled("zod/DefaultImport", {
  install: ["zod@4.4.3"],
  backend: "cli",
  zodCompiler: true,
  target: "bun",
  files: {
    "/entry.ts": /* ts */ `
      import z from "zod";
      const S = z.object({ a: z.string().min(1) });
      console.log(S.safeParse({ a: "x" }).success, S.safeParse({ a: "" }).success);
    `,
  },
  run: { stdout: "true false" },
  onAfterBundle(api) {
    expect(api.readFile("/out.js")).toContain("__zod(() =>");
  },
});

itBundled("zod/NamedCtorImportsOnly", {
  install: ["zod@4.4.3"],
  backend: "cli",
  zodCompiler: true,
  target: "bun",
  files: {
    "/entry.ts": /* ts */ `
      import { object, string, number } from "zod";
      const S = object({ name: string().min(1), n: number().int() });
      console.log(JSON.stringify(S.parse({ name: "a", n: 2 })), S.safeParse({ name: "", n: 2 }).success);
    `,
  },
  run: { stdout: '{"name":"a","n":2} false' },
  onAfterBundle(api) {
    expect(api.readFile("/out.js")).toContain("__zod(() =>");
  },
});

itBundled("zod/ZodV4Specifier", {
  install: ["zod@4.4.3"],
  backend: "cli",
  zodCompiler: true,
  target: "bun",
  files: {
    "/entry.ts": /* ts */ `
      import { z } from "zod/v4";
      const S = z.object({ n: z.coerce.number() });
      console.log(JSON.stringify(S.parse({ n: "42" })));
    `,
  },
  run: { stdout: '{"n":42}' },
  onAfterBundle(api) {
    expect(api.readFile("/out.js")).toContain("__zod(() =>");
  },
});

itBundled("zod/UnusedSchemaIsTreeShaken", {
  install: ["zod@4.4.3"],
  backend: "cli",
  zodCompiler: true,
  target: "bun",
  files: {
    "/entry.ts": /* ts */ `
      import { z } from "zod";
      const Used = z.object({ marker_used: z.string() });
      const Unused = z.object({ marker_unused: z.string() });
      console.log(Used.safeParse({ marker_used: "x" }).success);
    `,
  },
  run: { stdout: "true" },
  onAfterBundle(api) {
    const code = api.readFile("/out.js");
    expect(code).toContain("marker_used");
    // The wrapper call is pure, so the unused schema disappears entirely.
    expect(code).not.toContain("marker_unused");
  },
});

itBundled("zod/BrowserTargetBundles", {
  install: ["zod@4.4.3"],
  backend: "cli",
  zodCompiler: true,
  target: "browser",
  files: {
    "/entry.ts": /* ts */ `
      import { z } from "zod";
      const S = z.object({ a: z.string() });
      console.log(S.parse({ a: "x" }).a);
    `,
  },
  // The helper is plain JS inlined from the bundler runtime; a browser-target
  // bundle must still execute (here under bun, which has no browser globals
  // the helper would need anyway).
  run: { stdout: "x" },
  onAfterBundle(api) {
    expect(api.readFile("/out.js")).toContain("__zod(() =>");
  },
});

itBundled("zod/NoBundleTransformsToo", {
  install: ["zod@4.4.3"],
  zodCompiler: true,
  bundling: false,
  target: "bun",
  files: {
    "/entry.ts": /* ts */ `
      import { z } from "zod";
      const S = z.object({ a: z.string() });
      console.log(S.parse({ a: "x" }).a);
    `,
  },
  run: { stdout: "x" },
  onAfterBundle(api) {
    const code = api.readFile("/out.js");
    // Transpiled only: zod stays an import, and the helper comes from the
    // runtime's helper module like every other --no-bundle transform.
    expect(code).toContain('from "zod"');
    expect(code).toContain('from "bun:wrap"');
    expect(code).toMatch(/__zod\w*\(\(\) =>/);
  },
});

itBundled("zod/FoldedStringsKeepEverySegment", {
  install: ["zod@4.4.3"],
  backend: "cli",
  zodCompiler: true,
  minifySyntax: true,
  target: "bun",
  files: {
    "/entry.ts": /* ts */ `
      import { z } from "zod";
      // --minify-syntax folds these additions into rope strings before the
      // transform reads them. Every schema below must see the whole string.
      const Lit = z.literal("a" + "b");
      const En = z.enum(["x" + "y"]);
      const Prefix = z.string().startsWith("pre" + "fix");
      const Def = z.string().default("d" + "ef");
      const Tagged = z.discriminatedUnion("ki" + "nd", [
        z.object({ kind: z.literal("o" + "k"), value: z.string() }),
      ]);
      console.log(Lit.safeParse("a").success, Lit.safeParse("ab").success);
      console.log(En.safeParse("x").success, En.safeParse("xy").success);
      console.log(Prefix.safeParse("pre-rest").success, Prefix.safeParse("prefix-rest").success);
      console.log(Def.parse(undefined));
      console.log(Tagged.safeParse({ kind: "o", value: "v" }).success, Tagged.safeParse({ kind: "ok", value: "v" }).success);
    `,
  },
  run: { stdout: "false true\nfalse true\nfalse true\ndef\nfalse true" },
  onAfterBundle(api) {
    const code = api.readFile("/out.js");
    expect(code).toContain('"vs":["ab"]');
    expect(code).toContain('"vs":["xy"]');
    expect(code).toContain('["sw","prefix"]');
    expect(code).toContain('"v":"def"');
    expect(code).toContain('"d":"kind"');
    expect(code).toContain('"vs":["ok"]');
  },
});

itBundled("zod/CheckOnBooleanStillThrows", {
  install: ["zod@4.4.3"],
  backend: "cli",
  zodCompiler: true,
  target: "bun",
  files: {
    "/entry.ts": /* ts */ `
      import { z } from "zod";
      // z.boolean() has no .min(). zod throws while constructing the schema;
      // the wrapper defers that to the first parse instead of accepting input.
      const Broken = (z.boolean() as any).min(5);
      try {
        console.log("parsed", Broken.parse(true));
      } catch (error) {
        console.log(error instanceof TypeError, error.message.includes("min is not a function"));
      }
    `,
  },
  run: { stdout: "true true" },
  onAfterBundle(api) {
    expect(api.readFile("/out.js")).toContain('"k":"bool","c":[["minl",5]]');
  },
});

itBundled("zod/MacroRemappedImportStaysAMacro", {
  backend: "cli",
  zodCompiler: true,
  target: "bun",
  files: {
    "/entry.ts": /* ts */ `
      import { object } from "zod";
      const S = object();
      console.log(S);
    `,
    // bunfig remaps this import of zod to a macro. The transform must not
    // claim the binding, or the macro would never run.
    "/bunfig.toml": /* toml */ `
      [macros.zod]
      object = "./zod-macro.ts"
    `,
    "/zod-macro.ts": /* ts */ `
      export function object() {
        return "from-macro";
      }
    `,
  },
  run: { stdout: "from-macro" },
  onAfterBundle(api) {
    const code = api.readFile("/out.js");
    expect(code).toContain('"from-macro"');
    expect(code).not.toContain("__zod(() =>");
  },
});

itBundled("zod/ForeignStateOnAChildIsIgnored", {
  install: ["zod@4.4.3"],
  backend: "cli",
  zodCompiler: true,
  target: "bun",
  files: {
    "/entry.ts": /* ts */ `
      import { z } from "zod";
      // .describe() keeps Inner a real zod schema. Give it the helper's
      // registry symbol with a state shaped like this helper's own, as a
      // second copy of the helper in the same process would: its compiled
      // validator answers with that copy's fail sentinel.
      const Inner = z.string().describe("inner");
      const foreignFail = {};
      (Inner as any)[Symbol.for("__bunZodLazy")] = {
        thunk: () => Inner,
        ir: '{"v":1,"n":{"k":"str"}}',
        refs: [],
        node: undefined,
        compiled: () => foreignFail,
        real: undefined,
        fail: foreignFail,
      };
      const Outer = z.object({ x: Inner });
      console.log(JSON.stringify(Outer.parse({ x: "a" })), Outer.safeParse({ x: 1 }).success);
    `,
  },
  run: { stdout: '{"x":"a"} false' },
  onAfterBundle(api) {
    // Outer is compiled with Inner as a runtime ref, so the parse goes through __zodRunRef.
    expect(api.readFile("/out.js")).toContain('"k":"ref"');
  },
});

itBundled("zod/LiteralHeldByReferenceMayBeAnArray", {
  install: ["zod@4.4.3"],
  backend: "cli",
  zodCompiler: true,
  target: "bun",
  files: {
    "/entry.ts": /* ts */ `
      import { z } from "zod";
      const KINDS = ["a", "b"];
      const LIMIT = 3;
      // zod spreads the array into two accepted values. The compiled literal
      // only holds a reference, so it has to hand both cases to zod: the union
      // must not move on to the uppercasing option, and the array itself is
      // not an accepted value.
      const U = z.union([z.literal(KINDS), z.string().toUpperCase()]);
      const L = z.literal(KINDS);
      const N = z.literal(LIMIT);
      console.log(U.parse("a"), L.safeParse(KINDS as any).success, L.safeParse("a").success);
      console.log(N.safeParse(3).success, N.safeParse(4).success);
    `,
  },
  run: { stdout: "a false true\ntrue false" },
  onAfterBundle(api) {
    // Both literals compile to reference slots; the primitive one keeps its fast path.
    expect(api.readFile("/out.js").split('"k":"lit","vs":[],"rs":[0]')).toHaveLength(4);
  },
});

itBundled("zod/TupleParamsAreNotARestSchema", {
  install: ["zod@4.4.3"],
  backend: "cli",
  zodCompiler: true,
  target: "bun",
  files: {
    "/entry.ts": /* ts */ `
      import { z } from "zod";
      // zod reads the second argument as a rest schema only when it is a
      // schema; a params object or message there configures errors.
      const Pair = z.tuple([z.string(), z.number()], { error: "pair" });
      const Rest = z.tuple([z.string()], z.number(), { error: "rest" });
      const Msg = z.tuple([z.string()], "msg");
      console.log(JSON.stringify(Pair.parse(["a", 1])), Pair.safeParse(["a", 1, 2]).error!.issues[0].message);
      console.log(JSON.stringify(Rest.parse(["a", 1, 2])), Rest.safeParse("x").error!.issues[0].message);
      console.log(JSON.stringify(Msg.parse(["a"])), Msg.safeParse(["a", "b"]).error!.issues[0].message);
    `,
  },
  run: { stdout: '["a",1] pair\n["a",1,2] rest\n["a"] msg' },
  onAfterBundle(api) {
    const code = api.readFile("/out.js");
    // No tuple captures its params as a runtime ref.
    expect(code).not.toContain('"k":"ref"');
    expect(code).toContain('"k":"tup","it":[{"k":"str"},{"k":"num"}]}');
    expect(code).toContain('"k":"tup","it":[{"k":"str"}],"rest":{"k":"num"}}');
    expect(code).toContain('"k":"tup","it":[{"k":"str"}]}');
  },
});

// The compiled validator mirrors zod 4.4. Where earlier 4.x releases answer
// differently, it has to hand the input to the zod that is installed: 4.1
// validates an own "__proto__" key in catchall objects, validates
// non-enumerable record keys, and rejects a record whose own `constructor` is
// not a function. 4.4 skips the first two and accepts the third.
itBundled("zod/ReleaseDependentInputsGoToTheInstalledZod", {
  install: ["zod@4.1.0"],
  backend: "cli",
  zodCompiler: true,
  target: "bun",
  files: {
    "/entry.ts": /* ts */ `
      import { z } from "zod";
      const Strict = z.strictObject({ a: z.string() });
      const Loose = z.looseObject({ a: z.string() });
      const Rec = z.record(z.string(), z.number());
      // Under 4.4 the strict option accepts this input and wins; under 4.1 it
      // rejects and the second option wins. Either way the answer is zod's.
      const Union = z.union([z.strictObject({ a: z.string() }), z.object({ a: z.string().toUpperCase() })]);
      const protoKey = JSON.parse('{"__proto__": {"p": 1}, "a": "s"}');
      const hidden = { k: 1 };
      Object.defineProperty(hidden, "hidden", { value: 9, enumerable: false });
      console.log(Strict.safeParse(protoKey).success, Strict.safeParse({ a: "s" }).success);
      console.log(Object.getPrototypeOf(Loose.parse(protoKey)) === Object.prototype);
      console.log(JSON.stringify(Rec.parse(hidden)), JSON.stringify(Rec.parse({ k: 1 })));
      console.log(Rec.safeParse(JSON.parse('{"constructor": 0, "k": 1}')).success);
      console.log(JSON.stringify(Union.parse(protoKey)));
    `,
  },
  run: { stdout: 'false true\nfalse\n{"k":1,"hidden":9} {"k":1}\nfalse\n{"a":"S"}' },
});
