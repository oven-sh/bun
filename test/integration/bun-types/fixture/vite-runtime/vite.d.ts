// Stand-in for the `ViteHotContext` of vite/types/hot.d.ts and the `ImportMeta` subtypes that
// vite's node types declare with it. vite 5 names the subtype `ViteRuntimeImportMeta`
// (dist/node/types.d.ts) and vite 6+ names it `ModuleRunnerImportMeta` (dist/node/module-runner.d.ts).
// Both declare `hot?: ViteHotContext`, so `ImportMeta.hot` must accept `undefined` and every
// method of `ViteHotContext` must satisfy Bun's, or tsc reports TS2430 under `skipLibCheck: false`.

interface ModuleNamespace extends Record<string, any> {
  [Symbol.toStringTag]: "Module";
}

interface CustomEventMap {
  "vite:beforeUpdate": { type: "update" };
  "vite:afterUpdate": { type: "update" };
  "vite:beforeFullReload": { path?: string };
  "vite:beforePrune": { paths: string[] };
  "vite:invalidate": { path: string; message?: string };
  "vite:error": { err: Error };
  "vite:ws:disconnect": { webSocket: WebSocket };
  "vite:ws:connect": { webSocket: WebSocket };
}

type InferCustomEventPayload<T extends string> = T extends keyof CustomEventMap ? CustomEventMap[T] : any;

interface ViteHotContext {
  readonly data: any;

  accept(): void;
  accept(cb: (mod: ModuleNamespace | undefined) => void): void;
  accept(dep: string, cb: (mod: ModuleNamespace | undefined) => void): void;
  accept(deps: readonly string[], cb: (mods: Array<ModuleNamespace | undefined>) => void): void;

  acceptExports(exportNames: string | readonly string[], cb?: (mod: ModuleNamespace | undefined) => void): void;

  dispose(cb: (data: any) => void): void;
  prune(cb: (data: any) => void): void;
  invalidate(message?: string): void;

  on<T extends string>(event: T, cb: (payload: InferCustomEventPayload<T>) => void): void;
  off<T extends string>(event: T, cb: (payload: InferCustomEventPayload<T>) => void): void;
  send<T extends string>(event: T, data?: InferCustomEventPayload<T>): void;
}

interface ViteImportMetaEnv {
  [key: string]: any;
  BASE_URL: string;
  MODE: string;
  DEV: boolean;
  PROD: boolean;
  SSR: boolean;
}

interface ViteRuntimeImportMeta extends ImportMeta {
  url: string;
  env: ViteImportMetaEnv;
  hot?: ViteHotContext;
  [key: string]: any;
}

interface ModuleRunnerImportMeta extends ImportMeta {
  url: string;
  env: ViteImportMetaEnv;
  hot?: ViteHotContext;
  [key: string]: any;
}
