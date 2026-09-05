import * as tsd from "./utilities";

const t = new Bun.Transpiler({ loader: "ts" });
const { buffer, root, visit } = t.unstable_parse("const x = 1");

tsd.expectType<ArrayBuffer>(buffer);
tsd.expectType<"ast">(root.kind);
tsd.expectType<string | null>(root.hashbang);
tsd.expectType<number>(root.approximateNewlineCount);
tsd.expectAssignable<"none" | "cjs" | "esm" | "esm_with_dynamic_fallback" | "esm_with_dynamic_fallback_from_cjs">(
  root.exportsKind,
);

// stmts are statement nodes only
tsd.expectAssignable<Bun.UnstableStmtKind>(root.stmts[0]!.kind);

// Per-kind handlers narrow `kind` to the literal.
visit({
  e_call(n) {
    tsd.expectType<"e_call">(n.kind);
    tsd.expectType<number | null>(n.loc);
    tsd.expectType<unknown>(n.target);
    return false;
  },
  s_function(n) {
    tsd.expectType<"s_function">(n.kind);
  },
  b_identifier(n) {
    tsd.expectType<"b_identifier">(n.kind);
  },
  enter(n) {
    tsd.expectAssignable<Bun.UnstableASTKind>(n.kind);
  },
});

// Unknown visitor keys are a type error.
visit({
  // @ts-expect-error - "e_nope" is not a valid UnstableASTKind
  e_nope() {},
});

// Empty visitors object is fine (all keys optional).
visit({});

// Loader string and loader object both typecheck.
t.unstable_parse("x", "ts");
t.unstable_parse("x", { loader: "tsx" });
