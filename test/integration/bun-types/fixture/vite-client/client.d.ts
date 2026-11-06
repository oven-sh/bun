// Stand-in for `vite/client`. Its `ImportMeta.glob` is a property, with options and type parameters Bun's lacks.
// Its `ImportMeta.hot` is vite's `ViteHotContext` (vite/types/hot.d.ts), with methods Bun's lacks.

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

interface ViteModuleNamespace extends Record<string, any> {
  [Symbol.toStringTag]: "Module";
}

interface ViteHotContext {
  readonly data: any;
  accept(): void;
  accept(cb: (mod: ViteModuleNamespace | undefined) => void): void;
  accept(dep: string, cb: (mod: ViteModuleNamespace | undefined) => void): void;
  accept(deps: readonly string[], cb: (mods: Array<ViteModuleNamespace | undefined>) => void): void;
  acceptExports(exportNames: string | readonly string[], cb?: (mod: ViteModuleNamespace | undefined) => void): void;
  dispose(cb: (data: any) => void): void;
  prune(cb: (data: any) => void): void;
  invalidate(message?: string): void;
  on<T extends string>(event: T, cb: (payload: any) => void): void;
  off<T extends string>(event: T, cb: (payload: any) => void): void;
  send<T extends string>(event: T, data?: any): void;
}

interface ImportMeta {
  glob: ViteGlobFunction;
  readonly hot?: ViteHotContext;
}
