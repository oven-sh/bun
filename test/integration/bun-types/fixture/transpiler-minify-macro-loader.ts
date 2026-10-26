import { expectType } from "./utilities";

// `minify` is a boolean, or an object with a flag for each kind of minification.
{
  expectType<NonNullable<Bun.TranspilerOptions["minify"]>>().is<
    boolean | { whitespace?: boolean; syntax?: boolean; identifiers?: boolean }
  >();

  new Bun.Transpiler({ minify: true });
  new Bun.Transpiler({ minify: false });
  new Bun.Transpiler({ minify: {} });
  new Bun.Transpiler({ minify: { whitespace: true } });
  new Bun.Transpiler({ minify: { syntax: true } });
  new Bun.Transpiler({ minify: { identifiers: true } });
  new Bun.Transpiler({ minifyWhitespace: true, minify: { whitespace: false, syntax: true, identifiers: true } });

  const options: Bun.TranspilerOptions = { target: "bun", minify: { syntax: true } };
  new Bun.Transpiler(options);

  // @ts-expect-error - the constructor throws a TypeError for a string
  new Bun.Transpiler({ minify: "all" });
  // @ts-expect-error - the constructor throws a TypeError for a number
  new Bun.Transpiler({ minify: 1 });
  // @ts-expect-error - `keepNames` is an option of Bun.build(). Bun.Transpiler does not read it.
  new Bun.Transpiler({ minify: { identifiers: true, keepNames: true } });
}

// `macro` is a map of macros, or a boolean. `false` turns macros off.
{
  expectType<NonNullable<Bun.TranspilerOptions["macro"]>>().is<Bun.MacroMap | boolean>();

  new Bun.Transpiler({ macro: false });
  new Bun.Transpiler({ macro: true });
  new Bun.Transpiler({ macro: { "react-relay": { graphql: "bun-macro-relay" } } });

  const trusted: boolean = false;
  new Bun.Transpiler({ loader: "ts", macro: trusted });

  // @ts-expect-error - the constructor throws "macro must be an object" for a number
  new Bun.Transpiler({ macro: 1 });
}

// `transform()` and `transformSync()` take a JavaScript loader or a data loader for one call.
{
  expectType<Bun.TranspilerLoader>().is<
    "jsx" | "js" | "ts" | "tsx" | "json" | "jsonc" | "json5" | "toml" | "yaml" | "xml" | "text" | "md"
  >();

  const transpiler = new Bun.Transpiler({ loader: "tsx" });

  expectType(transpiler.transformSync('{ "name": "bun" }', "json")).is<string>();
  expectType(transpiler.transformSync('{ "name": "bun", }', "jsonc")).is<string>();
  expectType(transpiler.transformSync("{ name: 'bun' }", "json5")).is<string>();
  expectType(transpiler.transformSync('name = "bun"', "toml")).is<string>();
  expectType(transpiler.transformSync("name: bun", "yaml")).is<string>();
  expectType(transpiler.transformSync("<name>bun</name>", "xml")).is<string>();
  expectType(transpiler.transformSync("Hello, Bun!", "text")).is<string>();
  expectType(transpiler.transformSync("# Hello", "md")).is<string>();
  expectType(transpiler.transformSync("const a: number = 1;", "ts")).is<string>();

  expectType(transpiler.transformSync('{ "name": "bun" }', "json", {})).is<string>();
  expectType(transpiler.transformSync("const a: number = 1;", {})).is<string>();
  expectType(transpiler.transform("# Hello", "md")).is<Promise<string>>();
  expectType(transpiler.transform("const a: number = 1;", "ts")).is<Promise<string>>();

  // A wrapper names the type of its `loader` parameter.
  const transformWith = (code: string, loader: Bun.TranspilerLoader) => transpiler.transformSync(code, loader);
  expectType(transformWith("name: bun", "yaml")).is<string>();

  // A variable of the narrower type is still a loader for one call.
  const loader: Bun.JavaScriptLoader = "jsx";
  expectType(transpiler.transformSync("<div />", loader)).is<string>();

  // @ts-expect-error - transformSync() throws "Failed to parse code" for "css"
  transpiler.transformSync("a { color: red }", "css");
  // @ts-expect-error - transformSync() throws a TypeError for "file"
  transpiler.transformSync("", "file");
  // @ts-expect-error - the constructor throws "only JavaScript-like loaders supported for now"
  new Bun.Transpiler({ loader: "json" });
}

// `scan()` and `scanImports()` take a JavaScript loader for one call.
{
  const transpiler = new Bun.Transpiler({ loader: "js" });

  expectType(transpiler.scan("const a: number = 1;", "ts")).is<{ exports: string[]; imports: Bun.Import[] }>();
  expectType(transpiler.scan("export const a = <div />;", "tsx")).is<{ exports: string[]; imports: Bun.Import[] }>();
  expectType(transpiler.scan("export const a = 1;")).is<{ exports: string[]; imports: Bun.Import[] }>();
  expectType(transpiler.scanImports('import a from "a";', "ts")).is<Bun.Import[]>();
  expectType(transpiler.scanImports('import a from "a";')).is<Bun.Import[]>();

  // @ts-expect-error - scanImports() throws "Only JavaScript-like files support this fast path"
  transpiler.scanImports("{}", "json");
}
