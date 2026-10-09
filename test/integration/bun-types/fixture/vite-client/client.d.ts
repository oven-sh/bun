// Stands in for `vite/client`: a property on `ImportMeta`, with options and type parameters that Bun's `glob` lacks.

interface ViteGlobOptions<Eager extends boolean, As extends string> {
  as?: As;
  eager?: Eager;
  import?: string;
  query?: string | Record<string, string | number | boolean>;
  exhaustive?: boolean;
  base?: string;
  caseSensitive?: boolean;
}

interface ViteKnownAsTypes {
  raw: string;
  url: string;
}

interface ViteGlobFunction {
  <Eager extends boolean, As extends string, T = As extends keyof ViteKnownAsTypes ? ViteKnownAsTypes[As] : unknown>(
    glob: string | string[],
    options?: ViteGlobOptions<Eager, As>,
  ): (Eager extends true ? true : false) extends true ? Record<string, T> : Record<string, () => Promise<T>>;
  <M>(glob: string | string[], options?: ViteGlobOptions<false, string>): Record<string, () => Promise<M>>;
  <M>(glob: string | string[], options: ViteGlobOptions<true, string>): Record<string, M>;
}

interface ImportMeta {
  glob: ViteGlobFunction;
}
