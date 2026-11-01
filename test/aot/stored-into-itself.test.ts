// `o.self = o`: the test of the receiver is the test of the stored value too. Taken for the latter alone, it was left out where the store was resolved, and the compiler stopped in PlaceTypeTests.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { describe, test } from "./supported";

raiseDefaultTimeout(120_000);

const program = (base: string) => `class C extends ${base} {}
function see(o) { return o.self; }
function run(o = new C()) {
  see(o);
  o.self = o;
}
run({});
run();
console.log("ok");
`;

describe("compile/aot/stored-into-itself", () => {
  test.each(["Map", "Set", "WeakMap", "WeakSet", "Array", "Error", "Date", "Object"])(
    "an object of a class over %s is stored into itself",
    async base => {
      using dir = tempDir("aot-stored-into-itself", { "main.mjs": program(base) });
      const folder = String(dir);
      const executable = join(folder, "main");
      const build = await run(
        [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
        folder,
        bunEnv,
      );
      expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
        stderr: expect.not.stringContaining("Stopped while compiling"),
        exitCode: 0,
      });
      const plain = await run([bunExe(), "main.mjs"], folder, bunEnv);
      const compiled = await run([executable], folder, bunEnv);
      expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
        stdout: plain.stdout,
        exitCode: plain.exitCode,
      });
      expect(compiled.stdout).toBe("ok\n");
    },
  );
});
