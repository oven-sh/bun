// `bun compile` type checks what it builds, so a statement that runs on Bun and that the declarations of Bun refuse stops the build.
// The program below runs on Bun. The project is the one that `bun init` writes: no library for browsers, and the types of Bun.
import { expect, test } from "bun:test";
import { bunExe, tempDirWithBunTypes } from "harness";
import { run } from "../../aot/harness/run";

const tsconfig = JSON.stringify({
  compilerOptions: {
    lib: ["ESNext"],
    target: "ESNext",
    module: "Preserve",
    moduleDetection: "force",
    moduleResolution: "bundler",
    types: ["bun"],
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  },
});

const program = `const url = new URL("http://localhost/a/b");
const request = new Request(url, { method: "POST" });
const redirect = Response.redirect(url, 302);
console.log(request.method, new Request({ url }).url, redirect.headers.get("location"));
console.log(Response.redirect(url, { status: 307 }).status, URL.canParse(url), URL.parse(url)?.href);
console.log(URL.canParse("/c", url), URL.parse("c", url)?.href);

class Lines extends ReadableStream<string> {}
class Chunks extends ReadableStream {}
class Bytes<T extends Uint8Array> extends ReadableStream<T> {
  constructor() {
    super({
      type: "bytes",
      pull(controller) {
        controller.enqueue(new Uint8Array([104, 105]));
        controller.close();
      },
    });
  }
}
const bytes: ReadableStream<Uint8Array<ArrayBuffer>> = new ReadableStream({ type: "bytes" });
const lines = new Lines({
  start(controller) {
    controller.enqueue("line");
    controller.close();
  },
});
console.log(await lines.text(), new Chunks({ type: "bytes" }) instanceof Chunks, bytes.locked);
const { value: chunk } = await new Bytes().getReader().read();
console.log(chunk instanceof Uint8Array, Buffer.isBuffer(chunk), chunk?.length);

const tag = new WebAssembly.Tag({ parameters: ["i32"] });
const exception = new WebAssembly.Exception(tag, [7]);
console.log(exception.is(tag), exception.is(WebAssembly.JSTag), exception.getArg(tag, 0));
`;

const printed = `POST http://localhost/a/b http://localhost/a/b
307 true http://localhost/a/b
true http://localhost/a/c
line true false
true false 2
true false 7
`;

// One check reads every declaration of Bun and of Node.js, which takes a debug build several seconds.
test("web globals take what the runtime takes", async () => {
  using dir = tempDirWithBunTypes("check-web-globals", { "tsconfig.json": tsconfig, "index.ts": program });
  expect(await run([bunExe(), "index.ts"], String(dir))).toEqual({ stdout: printed, stderr: "", exitCode: 0 });
  const checked = await run([bunExe(), "check", "--no-pretty"], String(dir));
  // The summary on stderr has a time in it. Where the check fails, the message shows all three.
  expect(checked.exitCode === 0 ? { stdout: checked.stdout, exitCode: 0 } : checked).toEqual({
    stdout: "",
    exitCode: 0,
  });
}, 60_000);
