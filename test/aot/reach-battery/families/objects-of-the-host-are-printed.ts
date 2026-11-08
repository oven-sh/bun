// An object of each class of the host that a small program can make, printed in each way. The printer runs every native getter on the prototypes of such an object, and looks for the method that prints it:
// what a build leaves out because "the program only makes a server" is asked for all the same once the server is printed.
// A program makes the object, prints it and ends by process.exit(): nothing else. Whatever more it did (a Response in the handler, a stop(), a last line) might bring what the fault lacks, and hide it.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const objects: Record<string, string> = {
  "a-server": `Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {} })`,
  "a-child": `Bun.spawn(["/bin/echo", "x"], { stdout: "ignore" })`,
  "a-child-that-ended": `Bun.spawnSync(["/bin/echo", "x"])`,
  "a-listener": `Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } })`,
  "a-response": `new Response("x", { status: 201, headers: { a: "b" } })`,
  "a-request": `new Request("http://localhost/x", { method: "POST", body: "y" })`,
  "a-blob": `new Blob(["x"], { type: "text/plain" })`,
  "a-file-of-the-web": `new File(["x"], "made-up.txt")`,
  "a-file": `Bun.file("/dev/null")`,
  "a-writer-of-a-file": `Bun.file("/dev/null").writer()`,
  "a-sink": `new Bun.ArrayBufferSink()`,
  "a-url": `new URL("http://user@localhost:81/x?y=1#z")`,
  "the-parameters-of-a-url": `new URLSearchParams("a=1&b=2")`,
  headers: `new Headers({ a: "b" })`,
  "a-form": `(form => (form.append("a", "b"), form))(new FormData())`,
  "a-glob": `new Bun.Glob("*.made-up")`,
  "a-transpiler": `new Bun.Transpiler()`,
  "a-hasher": `new Bun.CryptoHasher("sha1")`,
  "a-hash": `new Bun.SHA1()`,
  "a-cookie": `new Bun.Cookie("a", "b")`,
  "a-map-of-cookies": `new Bun.CookieMap("a=b")`,
  "a-rewriter": `new HTMLRewriter()`,
  "a-controller": `new AbortController()`,
  "a-signal": `AbortSignal.abort("made up")`,
  "an-event": `new Event("made-up")`,
  "an-event-with-a-detail": `new CustomEvent("made-up", { detail: 1 })`,
  "an-event-of-a-message": `new MessageEvent("message", { data: 1 })`,
  "an-event-of-an-error": `new ErrorEvent("error", { message: "made up" })`,
  "an-event-of-a-close": `new CloseEvent("close", { code: 1000 })`,
  "a-target-of-events": `new EventTarget()`,
  "a-decoder": `new TextDecoder()`,
  "an-encoder": `new TextEncoder()`,
  "a-readable-stream": `new ReadableStream()`,
  "a-reader": `new ReadableStream().getReader()`,
  "a-writable-stream": `new WritableStream()`,
  "a-transform-stream": `new TransformStream()`,
  "a-stream-that-decodes": `new TextDecoderStream()`,
  "a-stream-that-compresses": `new CompressionStream("gzip")`,
  "a-channel": `new MessageChannel()`,
  "a-port": `new MessageChannel().port1`,
  "a-channel-for-all": `new BroadcastChannel("made-up")`,
  "a-mark": `performance.mark("made-up")`,
  "an-observer-of-performance": `new PerformanceObserver(() => {})`,
  "a-buffer": `Buffer.from("x")`,
  "a-timeout": `setTimeout(() => {}, 1)`,
  "an-immediate": `setImmediate(() => {})`,
  "a-key": `await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, true, ["sign"])`,
  "an-exception-of-the-web": `new DOMException("made up", "AbortError")`,
  "a-socket-of-the-web": `new WebSocket("ws://127.0.0.1:1/")`,
  "a-worker": `new Worker("data:text/javascript,", { type: "module" })`,
  "a-client-of-a-store": `new Bun.S3Client({})`,
  "a-module-of-web-assembly": `new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))`,
  "a-memory-of-web-assembly": `new WebAssembly.Memory({ initial: 1 })`,
  "the-standard-output": `process.stdout`,
  "the-usage-of-memory": `process.memoryUsage`,
  "the-environment": `Bun.env === process.env`,
  "the-state-of-a-file": `require("node:fs").statSync("/dev/null")`,
  "an-entry-of-a-folder": `require("node:fs").readdirSync("/dev", { withFileTypes: true })[0].constructor.prototype`,
};

/** What varies from run to run (a port, a process id, a time, an address) is masked in what is printed: the driver takes each run of digits out. */
const ways: Record<string, string> = {
  "console-log": `console.log(made);`,
  "console-log-in-an-object": `console.log({ held: made });`,
  "bun-inspect": `console.log(Bun.inspect(made));`,
  "util-inspect": `console.log(require("node:util").inspect(made, { showHidden: true, depth: 3 }));`,
  "a-template": `let text;\ntry {\n  text = \`\${made}\`;\n} catch (error) {\n  text = error.name;\n}\nconsole.log(text);`,
  json: `let text;\ntry {\n  text = JSON.stringify(made);\n} catch (error) {\n  text = error.name;\n}\nconsole.log(text);`,
};

export default function write(folder: string) {
  for (const [object, make] of Object.entries(objects))
    for (const [way, print] of Object.entries(ways)) {
      const text = `const made = ${make};\n${print}\nprocess.exit(0);\n`;
      writeFileSync(
        join(folder, `${object}--${way}.${text.includes("await ") ? "mjs" : "js"}`),
        `// Mask: [0-9]+\n${text}`,
      );
    }
}
