// Fixture for "pending streaming compilation keeps the process alive".
//
// Starts a streaming compile of a wasm module and prints "settled" or "rejected"
// once the promise settles. Nothing else keeps the process alive: if the pending
// compilation does not hold an event loop ref, the process exits 0 before anything
// is printed, and if the ref is never released, the process does not exit.
//
// argv[2]: "compileStreaming" | "instantiateStreaming"
// argv[3]: "buffered" (Response over bytes) | "stream" (Response over a ReadableStream) |
//          "file" (Response over a file) | "fetch" (the Response of the server at argv[6])
// argv[4]: "await" awaits the promise at the top level of the module. Otherwise nothing awaits it.
// argv[5]: the path of the module
import { readFileSync } from "node:fs";

const [, , api, body, how, path, url] = process.argv;
const headers = { "Content-Type": "application/wasm" };

// "buffered" feeds the compiler synchronously in C++; the others go through the
// consumeStream builtin, which finalizes the compiler from JavaScript.
function source(): Response | Promise<Response> {
  switch (body) {
    case "stream": {
      const wasm = readFileSync(path);
      return new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(wasm);
            controller.close();
          },
        }),
        { headers },
      );
    }
    case "file":
      return new Response(Bun.file(path), { headers });
    case "fetch":
      return fetch(url);
    default:
      return new Response(readFileSync(path), { headers });
  }
}

const promise =
  api === "instantiateStreaming" ? WebAssembly.instantiateStreaming(source()) : WebAssembly.compileStreaming(source());

const settled = promise.then(
  () => console.log("settled"),
  error => console.log("rejected:", error?.constructor?.name),
);
if (how === "await") await settled;
