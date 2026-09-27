import { expectType } from "./utilities";

type ExportsReplace = NonNullable<NonNullable<Bun.TranspilerOptions["exports"]>["replace"]>;

expectType<ExportsReplace[string]>().is<
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly [name: string, value: string | number | boolean | null | undefined]
>();
expectType<ExportsReplace["default"]>().is<string | number | boolean | null | undefined>();

// The example in the JSDoc of `exports.replace`.
{
  const transpiler = new Bun.Transpiler({
    loader: "ts",
    exports: {
      replace: {
        revalidate: 60,
        getStaticProps: ["__N_SSG", true],
      },
    },
  });

  expectType(
    transpiler.transformSync(`
      export const revalidate = readConfig().revalidate;
      export const getStaticProps = async () => ({ props: await load() });
    `),
  ).is<string>();
}

// A plain value becomes the value of the export.
new Bun.Transpiler({
  exports: {
    replace: {
      aString: "bar",
      aNumber: 60,
      aBoolean: true,
      aNull: null,
      anUndefined: undefined,
    },
  },
});

// `[name, value]` replaces the export with an export called `name`.
new Bun.Transpiler({
  exports: {
    replace: {
      withString: ["__NAME", "bar"],
      withNumber: ["__NAME", 60],
      withBoolean: ["__N_SSG", true],
      withNull: ["__NAME", null],
      withUndefined: ["__NAME", undefined],
    },
  },
});

// The runtime only reads the pair, so a readonly tuple is accepted.
{
  const entry = ["__N_SSG", true] as const;
  new Bun.Transpiler({ exports: { replace: { getStaticProps: entry, getStaticPaths: entry } } });
}

// A map that is built before the constructor call.
{
  const replace: ExportsReplace = {};
  for (const name of ["getStaticProps", "getStaticPaths"]) {
    replace[name] = ["__N_SSG", true];
  }
  replace.revalidate = 60;
  new Bun.Transpiler({ exports: { eliminate: ["loader"], replace } });
}

// Maps with a type of their own, such as the type of the declaration before this one.
{
  const strings: Record<string, string> = { version: "1.0.0" };
  new Bun.Transpiler({ exports: { replace: strings } });

  const pairs: Record<string, number | [string, boolean]> = { revalidate: 60, getStaticProps: ["__N_SSG", true] };
  new Bun.Transpiler({ exports: { replace: pairs } });
}

// The `default` key takes a value, and not a pair.
{
  new Bun.Transpiler({ exports: { replace: { default: 60 } } });
  new Bun.Transpiler({ exports: { replace: { default: "bar", revalidate: 60 } } });

  // @ts-expect-error - the default key takes a value, and not a pair
  new Bun.Transpiler({ exports: { replace: { default: ["__N_SSG", true] } } });

  const entry = ["__N_SSG", true] as const;
  // @ts-expect-error - the default key takes a value, and not a pair
  new Bun.Transpiler({ exports: { replace: { default: entry } } });

  const replace: ExportsReplace = {};
  replace.default = 60;
  // @ts-expect-error - the default key takes a value, and not a pair
  replace.default = ["__N_SSG", true];
}

// The constructor throws for each of these values.
new Bun.Transpiler({
  exports: {
    replace: {
      // @ts-expect-error - bigint is not a replacement value
      aBigInt: 1n,
      // @ts-expect-error - symbol is not a replacement value
      aSymbol: Symbol("s"),
      // @ts-expect-error - function is not a replacement value
      aFunction: () => 1,
      // @ts-expect-error - object is not a replacement value
      anObject: { value: 1 },
      // @ts-expect-error - the pair needs a value
      nameOnly: ["__NAME"],
      // @ts-expect-error - the pair has two elements
      threeElements: ["__NAME", true, 1],
      // @ts-expect-error - the value of the pair is one of the plain values
      objectInPair: ["__NAME", { value: 1 }],
      // @ts-expect-error - the value of the pair cannot be another pair
      pairInPair: ["__NAME", ["__OTHER", 1]],
      // @ts-expect-error - the name of the pair is a string
      numberAsName: [1, true],
    },
  },
});
