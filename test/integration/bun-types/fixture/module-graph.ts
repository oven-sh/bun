import { expectType } from "./utilities";

{
  const graph = new Bun.unsafe.ModuleGraph({
    globals: { config: { name: "a" }, log: (line: string) => console.log(line) },
    onError(error, kind) {
      expectType(error).is<unknown>();
      expectType(kind).is<"uncaughtException" | "unhandledRejection">();
    },
  });
  const app = await graph.import<{ start(): void }>("./app.mjs");
  app.start();
  expectType(graph.mainModule).is<string | undefined>();
  expectType(graph.import("./x.ts")).is<Promise<any>>();
  // @ts-expect-error onError must be a function
  new Bun.unsafe.ModuleGraph({ onError: 1 });
  // @ts-expect-error globals must be an object
  new Bun.unsafe.ModuleGraph({ globals: "x" });
  // @ts-expect-error specifier must be a string
  graph.import(1);
  graph.dispose();
  new Bun.unsafe.ModuleGraph().dispose();
  {
    using scoped = new Bun.unsafe.ModuleGraph({ globals: {} });
    void scoped;
  }
}
