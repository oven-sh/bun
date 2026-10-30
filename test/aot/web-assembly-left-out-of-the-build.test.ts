// `--web-assembly=off` with a WebKit built from source builds a Bun without WebAssembly: the engine's code for it is not
// in the binary and there is no global of that name. These tests say what such a Bun, and an executable it compiles, tell
// a program that asks for WebAssembly. Every other build skips them.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { beforeAll, describe, test } from "./supported";

const isLeftOut = !("WebAssembly" in globalThis);

// (module (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))
const module = [
  0, 97, 115, 109, 1, 0, 0, 0, 1, 7, 1, 96, 2, 127, 127, 1, 127, 3, 2, 1, 0, 7, 7, 1, 3, 97, 100, 100, 0, 0, 10, 9, 1,
  7, 0, 32, 0, 32, 1, 106, 11,
];

const asks = `
console.log(typeof WebAssembly, "WebAssembly" in globalThis, Object.getOwnPropertyNames(globalThis).includes("WebAssembly"));
try {
  new WebAssembly.Module(new Uint8Array(${JSON.stringify(module)}));
  console.log("compiled");
} catch (error) {
  console.log(error.name + ": " + error.message);
}
`;
const answers = "undefined false false\nReferenceError: WebAssembly is not defined\n";

const imports = `
import path from "./add.wasm";
const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
console.log(bytes.length);
console.log(new WebAssembly.Instance(new WebAssembly.Module(bytes), {}).exports.add(2, 3));
`;

describe.skipIf(!isLeftOut)("a Bun built without WebAssembly", () => {
  let directory: ReturnType<typeof tempDir>;
  const inDirectory = (name: string) => join(String(directory), name);
  const compile = (source: string, executable: string) =>
    run([bunExe(), "build", "--compile", "--aot", inDirectory(source), "--outfile", inDirectory(executable)]);

  beforeAll(() => {
    directory = tempDir("aot-web-assembly-left-out", {
      "asks.js": asks,
      "imports.js": imports,
      "add.wasm": new Uint8Array(module),
    });
  });

  test("has no global of that name", async () => {
    expect(await run([bunExe(), inDirectory("asks.js")])).toEqual({ stdout: answers, stderr: "", exitCode: 0 });
  });

  test("no option of the engine brings it back", async () => {
    const env = { ...bunEnv, BUN_JSC_useWasm: "1", BUN_JSC_useWasmIPInt: "1" };
    expect(await run([bunExe(), inDirectory("asks.js")], String(directory), env)).toEqual({
      stdout: answers,
      stderr: "",
      exitCode: 0,
    });
  });

  test("an executable it compiles answers the same", async () => {
    expect((await compile("asks.js", "asks")).exitCode).toBe(0);
    expect(await run([inDirectory("asks")])).toEqual({ stdout: answers, stderr: "", exitCode: 0 });
  }, 120_000);

  test("the build says that a module the program imports can't run, and the executable names what is missing", async () => {
    const built = await compile("imports.js", "imports");
    expect(built.stderr).toContain("the WebAssembly module can't run: this build of Bun has no WebAssembly");
    expect(built.stderr).toContain("add.wasm");
    expect(built.exitCode).toBe(0);
    const ran = await run([inDirectory("imports")]);
    expect(ran.stdout).toBe(module.length + "\n");
    expect(ran.stderr).toContain("ReferenceError: WebAssembly is not defined");
    expect(ran.exitCode).toBe(1);
  }, 120_000);
});
