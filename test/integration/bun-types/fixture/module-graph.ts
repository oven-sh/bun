import { expectType } from "./utilities";

{
  const graph = new Bun.ModuleGraph({
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
  new Bun.ModuleGraph({ onError: 1 });
  // @ts-expect-error globals must be an object
  new Bun.ModuleGraph({ globals: "x" });
  // @ts-expect-error specifier must be a string
  graph.import(1);
  const isolated = new Bun.ModuleGraph({ isolateIO: true });
  expectType(isolated.run((a: number, b: string) => a + b.length, 1, "x")).is<number>();
  expectType(isolated.run(async () => "done")).is<Promise<string>>();
  // @ts-expect-error arguments must match fn's parameters
  isolated.run((a: number) => a, "x");
  // @ts-expect-error fn must be a function
  isolated.run(1);
  // @ts-expect-error isolateIO must be a boolean
  new Bun.ModuleGraph({ isolateIO: "yes" });
  isolated.dispose();
  graph.dispose();
  new Bun.ModuleGraph().dispose();
  {
    using scoped = new Bun.ModuleGraph({ globals: {} });
    void scoped;
  }
}

expectType(Bun.ModuleGraph.current).is<Bun.ModuleGraph | undefined>();
