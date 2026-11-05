import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// The compiler's Link says of some lists, tables and views that they stay as their class has made them, and compiled code leans on that without a look.
// Under this testing word each such word is held against the object where it is taken, and the executable stops where it is false.
// Every program of ./parallel/objects-as-made is right, and does something to an object of a built-in class that once left the word standing falsely.
const word = "--aot-testing=HoldsObjectsToStayingAsMade";
const folder = join(import.meta.dir, "parallel", "objects-as-made");

for (const name of readdirSync(folder).sort()) {
  test(name, async () => {
    using dir = tempDir("objects-as-made", {});
    const plain = await run([bunExe(), join(folder, name)], String(dir), bunEnv);
    expect(plain.exitCode).toBe(0);
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", word, join(folder, name), "--outfile", join(String(dir), "program")],
      String(dir),
      bunEnv,
    );
    expect(built.exitCode).toBe(0);
    const compiled = await run([join(String(dir), "program")], String(dir), bunEnv);
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });
}
