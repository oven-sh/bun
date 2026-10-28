// A Worker's entry is another compiled module: named by a URL, by a relative text, by an absolute path, by a path computed at run time, by a CommonJS file, with preloads; both import one shared module, whose state each thread has for itself.
import { join } from "node:path";
import { bump, describe, Shared } from "./lib/shared";

const start = (what: string, make: () => Worker) =>
  new Promise<void>(resolve => {
    let worker: Worker;
    try {
      worker = make();
    } catch (error) {
      console.log(what, "THROWS", (error as Error).name);
      return resolve();
    }
    const heard: string[] = [];
    worker.onmessage = event => heard.push(event.data);
    worker.onerror = event => (heard.push("error"), event.preventDefault());
    worker.addEventListener("close", event => (console.log(what + ":", heard.join(" | "), "| close", (event as any).code), resolve()));
  });

bump();
bump();
console.log("here:", describe(new Shared("main")));
await start("a URL", () => new Worker(new URL("./worker.ts", import.meta.url)));
await start("the URL's text", () => new Worker(new URL("./worker.ts", import.meta.url).href));
await start("a relative text", () => new Worker("./worker.ts"));
await start("an absolute path", () => new Worker(join(import.meta.dir, "worker.ts")));
const parts = ["wor", "ker"];
await start("a computed path", () => new Worker("./" + parts.join("") + (Date.now() > 0 ? ".ts" : ".js")));
await start("computed, in a folder", () => new Worker(["." , "lib", "deep" + "-worker.ts"].join("/")));
await start("a CommonJS file", () => new Worker("./common.cjs"));
await start("an untyped module", () => new Worker("./untyped.mjs"));
await start("a module that only imports", () => new Worker("./only-imports.ts"));
await start("a module with a top-level await", () => new Worker("./awaits.ts"));
await start("a module that throws while it loads", () => new Worker("./throws.ts"));
await start("a file that is not there", () => new Worker("./nowhere.ts"));
await start("a preload", () => new Worker("./worker.ts", { preload: ["./preloaded.ts"] } as any));
console.log("here, behind them:", describe(new Shared("main")));
