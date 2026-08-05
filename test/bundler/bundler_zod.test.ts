// Bundler integration for the zod transform (BUN_FEATURE_FLAG_EXPERIMENTAL_ZOD).
// The runtime-transpiler path and full differential coverage live in
// test/bundler/transpiler/zod-transform.test.ts.
import { itBundled, testForFile } from "./expectBundled";
var { expect } = testForFile(import.meta.path);

const zodEnv = { BUN_FEATURE_FLAG_EXPERIMENTAL_ZOD: "1" };

itBundled("zod/TransformBasic", {
  install: ["zod@4.4.3"],
  backend: "cli",
  env: zodEnv,
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
  env: zodEnv,
  target: "bun",
  files: {
    "/entry.ts": /* ts */ `
      import { z } from "zod";
      function limit() { return 2; }
      // A call expression as a check argument is not provably pure, so this
      // schema must be left untransformed.
      const S = z.string().min(limit());
      console.log(S.safeParse("a").success, S.safeParse("abc").success);
      // A pure sibling still transforms.
      const T = z.string().min(2);
      console.log(T.safeParse("abc").success);
    `,
  },
  run: { stdout: "false true\ntrue" },
  onAfterBundle(api) {
    const code = api.readFile("/out.js");
    expect(code).toContain('min(limit())');
    expect(code.split("__zod(() =>").length - 1).toBe(1);
  },
});

itBundled("zod/OpaqueChildKeepsOwnWrapper", {
  install: ["zod@4.4.3"],
  backend: "cli",
  env: zodEnv,
  target: "bun",
  files: {
    "/entry.ts": /* ts */ `
      import { z } from "zod";
      // .email() has no compiled fast path; it keeps its own lazy wrapper
      // while the enclosing object still compiles.
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
  env: zodEnv,
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
  env: zodEnv,
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

itBundled("zod/ZodV4Specifier", {
  install: ["zod@4.4.3"],
  backend: "cli",
  env: zodEnv,
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
  env: zodEnv,
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
  env: zodEnv,
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
