import { expectType } from "./utilities";

const transpiler = new Bun.Transpiler({ loader: "ts" });
const source = "const x: number = 1;";

// The string methods keep their types.
expectType(transpiler.transformSync(source)).is<string>();
expectType(transpiler.transformSync(source, "tsx")).is<string>();
expectType(transpiler.transformSync(source, { macroContext: true })).is<string>();
expectType(transpiler.transform(source)).is<Promise<string>>();

// A transpiler from options that are not a literal still returns a string.
function fromOptions(options: Bun.TranspilerOptions): string {
  return new Bun.Transpiler(options).transformSync(source);
}
function fromParameters(...parameters: ConstructorParameters<typeof Bun.Transpiler>): Promise<string> {
  return new Bun.Transpiler(...parameters).transform(source);
}
const pool = new Map<string, Bun.Transpiler>([["ts", transpiler]]);
const instance: InstanceType<typeof Bun.Transpiler> = transpiler;
expectType(fromOptions({ loader: "tsx" })).is<string>();
expectType(fromParameters({ target: "bun" })).is<Promise<string>>();
expectType(pool.get("ts")!.transformSync(source)).is<string>();
expectType(instance.transformSync(source)).is<string>();

// The source map methods always return { code, map }.
const result = transpiler.transformWithSourceMapSync(source);
expectType(result).is<Bun.TransformWithSourceMapResult>();
expectType(transpiler.transformWithSourceMapSync(source, "tsx")).is<Bun.TransformWithSourceMapResult>();
expectType(transpiler.transformWithSourceMap(source)).is<Promise<Bun.TransformWithSourceMapResult>>();
expectType(transpiler.transformWithSourceMap(source, "jsx")).is<Promise<Bun.TransformWithSourceMapResult>>();
expectType(transpiler.transformWithSourceMapSync(new Uint8Array())).is<Bun.TransformWithSourceMapResult>();
expectType(transpiler.transformWithSourceMapSync(new ArrayBuffer(0))).is<Bun.TransformWithSourceMapResult>();

expectType(result.code).is<string>();
expectType(result.map).is<Bun.TranspilerSourceMap>();
expectType(result.map.version).is<3>();
expectType(result.map.sources).is<string[]>();
expectType(result.map.sourcesContent).is<string[]>();
expectType(result.map.mappings).is<string>();
expectType(result.map.names).is<string[]>();

// The map is a plain object that the caller can change.
result.map.sources[0] = "src/x.ts";
const { sourcesContent, ...withoutContent } = result.map;
expectType(sourcesContent).is<string[]>();
expectType(withoutContent).is<{ version: 3; sources: string[]; mappings: string; names: string[] }>();
expectType(JSON.stringify(result.map)).is<string>();

// The result fits the `{ code, map }` that bundler plugin hooks return.
const hookResult: {
  code: string;
  map?: { version: number; sources: string[]; mappings: string; names: string[] } | string | null;
} = result;
hookResult.code;

// @ts-expect-error the second argument is a loader, not an options object
transpiler.transformWithSourceMapSync(source, { loader: "ts" });
// @ts-expect-error the second argument is a loader, not an options object
transpiler.transformWithSourceMap(source, { loader: "ts" });
// @ts-expect-error there is no macro context argument
transpiler.transformWithSourceMapSync(source, "ts", {});
// @ts-expect-error the result is an object, not the code
transpiler.transformWithSourceMapSync(source).length;
// @ts-expect-error the map is an object, not text
Bun.write("out.js.map", result.map);
