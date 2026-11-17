import { expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    noEmit: true,
    target: "esnext",
    module: "esnext",
    moduleResolution: "bundler",
    lib: ["esnext"],
    types: [],
  },
});

const source = `type A = { kind: "a"; a: number };
type B = { kind: "b"; b: string };
declare function isAOrB(value: unknown): value is A | B;
class Base {
  base = 0;
}
class Derived extends Base {
  derived = 1;
}

export function unionByDiscriminant(x: A | B) {
  if (x.kind === "a") return x.a;
  return x.b;
}

export function unionByDiscriminantAfterOr(x: A | B, other: boolean) {
  if (other || x.kind === "a") {
    // @ts-expect-error
    return x.a;
  }
  return x.b;
}

export function optionalChain(x: { p?: number } | undefined) {
  if (x?.p !== undefined) return x.p;
  // @ts-expect-error
  return x.p;
}

export function optionalParameter(x?: { p: number }) {
  if (x?.p) return x.p;
  // @ts-expect-error
  return x.p;
}

export function narrowedToUnionFirst(x: unknown) {
  if (!isAOrB(x)) return 0;
  if (x.kind === "a") return x.a;
  return x.b;
}

export function byConstructor(x: Base) {
  if (x.constructor === Derived) {
    const nothing: never = x;
    return nothing;
  }
  return x.base;
}

export function byConstructorKey(x: Base) {
  if (x["constructor"] === Derived) {
    const nothing: never = x;
    return nothing;
  }
  return x.base;
}

export function tupleElements(pair: [A | B, A | B]) {
  if (pair[0].kind === "a") {
    // @ts-expect-error
    pair[1].a;
    return pair[0].a;
  }
  return 0;
}

export function elementsByLiteralKey(cache: (string | number)[], keyed: Record<string, string | number>) {
  if (typeof cache[0] === "string" || typeof cache[1] === "string") {
    // @ts-expect-error
    cache[0].length;
  }
  if (typeof cache[300] === "string" && typeof keyed["k"] === "string") {
    // @ts-expect-error
    cache[301].length;
    // @ts-expect-error
    keyed["j"].length;
    return cache[300].length + keyed["k"].length + keyed.k.length;
  }
  return 0;
}

export function manyReferencesInOneTest(
  a: string | number,
  b: string | number,
  c: string | number,
  d: string | number,
  e: string | number,
  f: string | number,
) {
  if (typeof a === "string" && typeof b === "string" && typeof c === "string" && typeof d === "string" && typeof e === "string") {
    // @ts-expect-error
    f.length;
    return a.length + b.length + c.length + d.length + e.length;
  }
  return 0;
}

export function wholeNameWithoutUnion(x: string) {
  if (x === "a") {
    const literal: "a" = x;
    return literal;
  }
  return x;
}

export function propertyOfNameWithoutUnion(options: { strict?: boolean; name: string }) {
  if (options.strict) {
    const strict: true = options.strict;
    const same: { strict?: boolean; name: string } = options;
    return strict && same.name;
  }
  return options.name;
}

export function neverAfterTestOnObject(x: { p: number }) {
  if (!x) {
    const nothing: never = x;
    return nothing;
  }
  if (x.p > 0 || x.p < 0) return x.p;
  return x.p;
}
`;

test("a test on a property narrows exactly the references TypeScript narrows", async () => {
  using dir = tempDir("check-narrowing-by-property", { "tsconfig.json": tsconfig, "narrowing.ts": source });
  const { stdout, stderr, exitCode } = await run([bunExe(), "check", "./narrowing.ts"], String(dir));
  expect({ output: exitCode ? stdout + stderr : "", exitCode }).toEqual({ output: "", exitCode: 0 });
});
