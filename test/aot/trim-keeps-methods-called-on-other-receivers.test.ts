import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { canTrim } from "../bundler/compile-trim-features";
import { run } from "./harness/run";
import { describe, test } from "./supported";

// Each program takes a method or a getter from the prototype of a host class and calls it on an object that is not an instance.
// It never creates an instance, so the call is the only use of the class that the build sees.
const calls = [
  `Blob.prototype.text.call({})`,
  `Blob.prototype.slice.call({})`,
  `Response.prototype.json.call({})`,
  `Headers.prototype.get.call({}, "a")`,
  `TextDecoder.prototype.decode.call({})`,
  `Reflect.apply(TextDecoder.prototype.decode, {}, [])`,
  `(0, TextDecoder.prototype.decode)()`,
  `Object.getOwnPropertyDescriptor(TextDecoder.prototype, "encoding").get.call({})`,
  `Bun.Glob.prototype.match.call({}, "a")`,
  `MessagePort.prototype.ref.call({})`,
  `BroadcastChannel.prototype.postMessage.call({}, 1)`,
];

if (!canTrim)
  console.error(
    "SKIPPED: trim-keeps-methods-called-on-other-receivers.test.ts: this build of Bun doesn't support --trim",
  );

describe.skipIf(!canTrim)("--trim keeps a host method that is called on another receiver", () => {
  test.concurrent.each(calls)(
    "%s",
    async call => {
      using dir = tempDir("aot-trim-other-receivers", {
        "program.js": `try {
  console.log("returns", typeof ${call});
} catch (error) {
  console.log("throws", error.name, error.code, error.message);
}
`,
      });
      const folder = String(dir);
      const buildAndRun = async (name: string, flags: string[]) => {
        const executable = join(folder, isWindows ? `${name}.exe` : name);
        const built = await run(
          [bunExe(), "build", "--compile", "--aot", ...flags, "program.js", "--outfile", executable],
          folder,
        );
        expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
          stderr: "",
          exitCode: 0,
        });
        return await run([executable], folder);
      };
      const plain = await run([bunExe(), "run", "program.js"], folder);
      expect(plain).toEqual({ stdout: expect.stringMatching(/^throws TypeError /), stderr: "", exitCode: 0 });
      expect(await buildAndRun("whole", [])).toEqual(plain);
      expect(await buildAndRun("trimmed", ["--trim"])).toEqual(plain);
    },
    120_000,
  );
});
