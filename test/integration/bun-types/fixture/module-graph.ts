import { expectType } from "./utilities";

{
  const graph = new Bun.ModuleGraph({
    globals: { config: { name: "a" }, log: (line: string) => console.log(line) },
    uncaughtException(error, origin) {
      expectType(error).is<unknown>();
      expectType(origin).is<"uncaughtException" | "unhandledRejection">();
    },
    unhandledRejection(reason, promise) {
      expectType(reason).is<unknown>();
      expectType(promise).is<Promise<unknown>>();
    },
  });
  const app = await graph.import<{ start(): void }>("./app.mjs");
  app.start();
  // @ts-expect-error there is no mainModule: the host has what import() gave it
  graph.mainModule;
  expectType(graph.import("./x.ts")).is<Promise<any>>();
  // @ts-expect-error uncaughtException must be a function
  new Bun.ModuleGraph({ uncaughtException: 1 });
  // @ts-expect-error unhandledRejection must be a function
  new Bun.ModuleGraph({ unhandledRejection: 1 });
  // @ts-expect-error there is no onError
  new Bun.ModuleGraph({ onError() {} });
  // @ts-expect-error globals must be an object
  new Bun.ModuleGraph({ globals: "x" });
  new Bun.ModuleGraph({ codeGeneration: { strings: false } }).dispose();
  new Bun.ModuleGraph({ codeGeneration: {} }).dispose();
  // @ts-expect-error codeGeneration.strings must be a boolean
  new Bun.ModuleGraph({ codeGeneration: { strings: "no" } });
  // @ts-expect-error codeGeneration must be an object
  new Bun.ModuleGraph({ codeGeneration: false });
  // @ts-expect-error specifier must be a string
  graph.import(1);
  graph.dispose();
  new Bun.ModuleGraph().dispose();
  {
    using scoped = new Bun.ModuleGraph({ globals: {} });
    void scoped;
  }
}

expectType(Bun.ModuleGraph.current).is<Bun.ModuleGraph | undefined>();
