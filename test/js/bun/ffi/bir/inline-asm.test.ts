import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import reference from "./fixtures/encodings/from-gnu-as.json";
import { lines, meets, run, runFixtures, supported } from "./run-fixtures";

// asm statements: the ones that need no assembler (hints, fences, cpuid) and the ones assembled at compile time.
runFixtures("inline-asm");

// The compiler's own encoder against GNU as: fixtures/encodings/from-gnu-as.json has what `as` wrote for each
// instruction, and instructions it refused (among them every mnemonic with registers of a size it does not work on,
// which encoded by number alone would be another instruction than the one written).
describe.skipIf(!supported || !meets("x64"))("the x86-64 encoder against GNU as", () => {
  const inTemplate = (instruction: string) => instruction.replaceAll("%", "%%").replaceAll('"', '\\"');

  test.concurrent("writes the bytes that as writes", async () => {
    const instructions = Object.keys(reference.encodings) as (keyof typeof reference.encodings)[];
    // Each instruction between two others that are found again in the function's code, which is read and not run.
    const source = [
      "#include <stdio.h>",
      ...instructions.map(
        (instruction, index) =>
          `void f${index}(void) { __asm__ volatile("movl $0x1BADC0DE, %%eax\\n\\t${inTemplate(instruction)}\\n\\tmovl $0x2BADC0DE, %%eax" ::: "memory"); }`,
      ),
      "static int marks(const unsigned char *p, unsigned char which) { return p[0] == 0xB8 && p[1] == 0xDE && p[2] == 0xC0 && p[3] == 0xAD && p[4] == which; }",
      "static void dump(void (*function)(void)) {",
      "  const unsigned char *p = (const unsigned char *)function;",
      "  while (!marks(p, 0x1B)) p++;",
      '  for (p += 5; !marks(p, 0x2B); p++) printf("%02x", *p);',
      '  printf("\\n");',
      "}",
      "int main(void) {",
      ...instructions.map((_, index) => `  dump(f${index});`),
      "  return 0;",
      "}",
      "",
    ].join("\n");
    using dir = tempDir("bir-encodings", { "encodings.c": source });
    const { stdout, stderr, exitCode } = await run(String(dir), ["encodings.c"]);
    expect(stderr).toBe("");
    const written = lines(stdout).split("\n");
    const differing = instructions
      .map((instruction, index) => ({ instruction, as: reference.encodings[instruction], here: written[index] }))
      .filter(({ as, here }) => as !== here);
    expect(differing).toEqual([]);
    expect(exitCode).toBe(0);
  });

  // One process imports a file per instruction and says what importing each came to: a file is refused for its first
  // error, and a process per file is more than five hundred of them.
  test.concurrent("refuses what as refuses", async () => {
    using dir = tempDir("bir-refused", {
      ...Object.fromEntries(
        reference.refused.map((instruction, index) => [
          `refused-${index}.c`,
          `void f(void) { __asm__ volatile("${inTemplate(instruction)}" ::: "memory"); }\n`,
        ]),
      ),
      "import-each.ts": `
        for (let index = 0; index < ${reference.refused.length}; index++) {
          try {
            await import("./refused-" + index + ".c");
            console.log("accepted");
          } catch (error) {
            console.log(String(error.message).split("\\n")[0]);
          }
        }
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["import-each.ts"]);
    expect(stderr).toBe("");
    const said = lines(stdout).split("\n");
    expect(reference.refused.filter((_, index) => !said[index]?.startsWith("inline assembly: "))).toEqual([]);
    expect(exitCode).toBe(0);
  });
});
