// Where native code takes one of a few words it also takes a String object, and makes a string of it by the object's own toString or Symbol.toPrimitive.
import { expect } from "bun:test";
import { realpathSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, spawned } from "./harness/commands";
import { test } from "./supported";

const programs = {
  "an argument": `
    let asked = 0;
    const format = new String("hex");
    format.toString = () => { asked++; return "css"; };
    console.log(Bun.color("red", format), asked);
  `,
  "a member of the options": `
    let asked = 0;
    const binaryType = new String("buffer");
    binaryType[Symbol.toPrimitive] = () => { asked++; return "uint8array"; };
    Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { binaryType, data() {} } }).stop(true);
    console.log(asked);
  `,
};

test.each(Object.entries(programs))(
  "%s",
  async (_, source) => {
    using dir = tempDir("aot-word-as-string-object", { "main.js": source });
    const root = realpathSync(String(dir));
    const executable = join(root, isWindows ? "program.exe" : "program");
    built(await spawned([bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", executable], root, bunEnv));
    const plain = await spawned([bunExe(), "main.js"], root, bunEnv);
    const compiled = await spawned([executable], root, bunEnv);
    expect(plain.stdout).toEndWith("1\n");
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  },
  120_000,
);
