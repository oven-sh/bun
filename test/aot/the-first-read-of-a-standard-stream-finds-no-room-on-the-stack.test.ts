// process.stdout and process.stderr are made at their first read, by code of Bun's library that needs room on the stack. Where
// that read stands in the deepest frames of a recursion that has just run out of stack, the code fails: Bun reports the error and
// the property is undefined from then on. The compiler held both to be objects always, and a read of a member died of a
// segmentation fault. The report goes to stderr with positions that differ between the two ways to run, so only stdout is compared.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, unsupported, withoutCoreDump } from "./run-programs";

const program = `function atTheBrink(run) {
  try {
    return atTheBrink(run);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return run();
  }
}

function report(label, run) {
  try {
    console.log(label + ":", run());
  } catch (error) {
    console.log(label + ":", error.name);
  }
}

report("stdout.write, first read", () => atTheBrink(() => typeof process.stdout.write));
report("stdout", () => typeof process.stdout);
report("stdout.write", () => typeof process.stdout.write);
report("stdout.write()", () => process.stdout.write(""));
report("stdout.fd", () => process.stdout.fd);
report("stdout.isTTY", () => process.stdout.isTTY);
report("stdout.columns", () => process.stdout.columns);
report("stdout.end", () => typeof process.stdout.end);
report("stdout.on()", () => typeof process.stdout.on("drain", () => {}));
report("stdout?.write", () => typeof process.stdout?.write);

report("stderr.write(), first read", () => atTheBrink(() => process.stderr.write("")));
report("stderr", () => typeof process.stderr);
report("stderr.write", () => typeof process.stderr.write);
report("stderr.fd", () => process.stderr.fd);

console.log("console.log still writes");
`;

test.skipIf(!!unsupported)(
  "a standard stream whose first read found no room on the stack is undefined in compiled code too",
  async () => {
    await slot(async () => {
      using dir = tempDir("aot-stream-at-the-brink", { "entry.js": program });
      const folder = String(dir);
      const executable = join(folder, isWindows ? "entry.exe" : "entry");
      const plain = await spawned([bunExe(), "run", "entry.js"], folder, bunEnv);
      expect(plain.stdout).toContain("stdout.write, first read: TypeError\nstdout: undefined\n");
      expect(plain.stdout).toEndWith("console.log still writes\n");
      built(
        await spawned([bunExe(), "build", "--compile", "--aot", "entry.js", "--outfile", executable], folder, bunEnv),
      );
      const ran = await spawned(withoutCoreDump([executable]), folder, bunEnv);
      expect({ stdout: ran.stdout, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
        stdout: plain.stdout,
        exitCode: plain.exitCode,
        signal: null,
      });
    });
  },
  240_000,
);
