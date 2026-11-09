// `bun compile` type checks what it builds, so a statement that runs on Bun and that the declarations of Bun refuse stops the build.
// The program below runs on Bun. The project is the one that `bun init` writes: no library for browsers, and the types of Bun.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithBunTypes } from "harness";

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
console.log(URL.canParse("/c", url), URL.parse("c", url)?.href);

class Lines extends ReadableStream<string> {}
class Chunks extends ReadableStream {}
const bytes: ReadableStream<Uint8Array<ArrayBuffer>> = new ReadableStream({ type: "bytes" });
const lines = new Lines({
  start(controller) {
    controller.enqueue("line");
    controller.close();
  },
});
console.log(await lines.text(), new Chunks() instanceof ReadableStream, bytes.locked);

const tag = new WebAssembly.Tag({ parameters: ["i32"] });
const exception = new WebAssembly.Exception(tag, [7]);
console.log(exception.is(tag), exception.is(WebAssembly.JSTag), exception.getArg(tag, 0));
`;

const printed = `POST http://localhost/a/b http://localhost/a/b
true http://localhost/a/c
line true false
true false 7
`;

async function run(dir: string, ...command: string[]) {
  await using proc = Bun.spawn({ cmd: [bunExe(), ...command], cwd: dir, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  return { stdout, exitCode };
}

// One check reads every declaration of Bun and of Node.js, which takes a debug build several seconds.
test("web globals take what the runtime takes", async () => {
  using dir = tempDirWithBunTypes("check-web-globals", { "tsconfig.json": tsconfig, "index.ts": program });
  expect(await run(String(dir), "index.ts")).toEqual({ stdout: printed, exitCode: 0 });
  const checked = await run(String(dir), "check", "--no-pretty");
  expect({
    errors: checked.stdout.split("\n").filter(line => line.includes("error TS")),
    exitCode: checked.exitCode,
  }).toEqual({
    errors: [],
    exitCode: 0,
  });
}, 60_000);
