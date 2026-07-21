import { expectType } from "./utilities";

// -- Bun.Transpiler exports.eliminate / exports.replace --

// `eliminate` and `replace` are keyed on the exported name, not the local one.
new Bun.Transpiler({
  loader: "ts",
  exports: {
    eliminate: ["QA", "getServerSideProps"],
  },
});

// Every scalar `exports.replace` accepts.
new Bun.Transpiler({
  loader: "ts",
  exports: {
    replace: {
      aString: "bar",
      aNumber: 9,
      aBoolean: true,
      aNull: null,
      anUndefined: undefined,
    },
  },
});

// The `[name, value]` pair exports `value` under `name` instead.
new Bun.Transpiler({
  loader: "ts",
  exports: {
    replace: {
      getStaticProps: ["__N_SSG", true],
      getServerSideProps: ["__N_SSP", 1],
      loader: ["__LOADER", "x"],
      nulled: ["__NULL", null],
    },
  },
});

// `eliminate` takes any exported name; `replace` keys are identifier-validated
// at runtime, so a string-named export can only be eliminated.
new Bun.Transpiler({ loader: "ts", exports: { eliminate: ["a-b"] } });

const transpiler = new Bun.Transpiler({ loader: "ts" });
expectType(transpiler.transformSync("const q = 1; export { q as QA };")).is<string>();
expectType(transpiler.scan("export { q as QA };").exports).is<string[]>();

// @ts-expect-error -- an object is not a valid replacement value
new Bun.Transpiler({ loader: "ts", exports: { replace: { foo: { a: 1 } } } });

// @ts-expect-error -- the pair's value must be a scalar, not an object
new Bun.Transpiler({ loader: "ts", exports: { replace: { foo: ["NAME", { a: 1 }] } } });

// @ts-expect-error -- `eliminate` takes a list of exported names
new Bun.Transpiler({ loader: "ts", exports: { eliminate: { foo: true } } });
