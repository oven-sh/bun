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
  // @ts-expect-error globals must be an object
  new Bun.ModuleGraph({ globals: "x" });
  // @ts-expect-error specifier must be a string
  graph.import(1);
  expectType(graph.run((a: number, b: string) => a + b.length, 1, "x")).is<number>();
  expectType(graph.run(async () => "done")).is<Promise<string>>();
  // @ts-expect-error arguments must match fn's parameters
  graph.run((a: number) => a, "x");
  // @ts-expect-error fn must be a function
  graph.run(1);
  graph.dispose();
  new Bun.ModuleGraph().dispose();
  {
    using scoped = new Bun.ModuleGraph({ globals: {} });
    void scoped;
  }
}

expectType(Bun.ModuleGraph.current).is<Bun.ModuleGraph | undefined>();
