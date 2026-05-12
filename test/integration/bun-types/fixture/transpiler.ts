import * as tsd from "./utilities";

// No sourcemap: return types must stay `string` so existing users who
// assign the result to `string` keep compiling (bun-plugin-svelte is one).
{
  const t = new Bun.Transpiler({ loader: "ts" });
  tsd.expectType<string>(t.transformSync("const x: number = 1;"));
  tsd.expectType<Promise<string>>(t.transform("const x: number = 1;"));

  // Assignable to `string`.
  const s: string = t.transformSync("const x: number = 1;");
  s.length;
}

// sourcemap: false — same as unset.
{
  const t = new Bun.Transpiler({ loader: "ts", sourcemap: false });
  tsd.expectType<string>(t.transformSync("const x: number = 1;"));
}

// sourcemap: "none" — string.
{
  const t = new Bun.Transpiler({ loader: "ts", sourcemap: "none" });
  tsd.expectType<string>(t.transformSync("const x: number = 1;"));
}

// sourcemap: "inline" — string (map embedded in the code).
{
  const t = new Bun.Transpiler({ loader: "ts", sourcemap: "inline" });
  tsd.expectType<string>(t.transformSync("const x: number = 1;"));
}

// sourcemap: true — string (alias for "inline").
{
  const t = new Bun.Transpiler({ loader: "ts", sourcemap: true });
  tsd.expectType<string>(t.transformSync("const x: number = 1;"));
}

// sourcemap: "external" — `{ code, map }`.
{
  const t = new Bun.Transpiler({ loader: "ts", sourcemap: "external" });
  const result = t.transformSync("const x: number = 1;");
  tsd.expectType<Bun.TranspilerTransformResult>(result);
  tsd.expectType<string>(result.code);
  tsd.expectType<string>(result.map);

  const p = t.transform("const x: number = 1;");
  tsd.expectType<Promise<Bun.TranspilerTransformResult>>(p);
}

// sourcemap: "linked" — `{ code, map }`.
{
  const t = new Bun.Transpiler({ loader: "ts", sourcemap: "linked" });
  const result = t.transformSync("const x: number = 1;");
  tsd.expectType<Bun.TranspilerTransformResult>(result);
}
