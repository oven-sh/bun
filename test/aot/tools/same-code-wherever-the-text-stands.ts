// Does a program compile to the same machine code wherever its text stands? Blanks, comments and empty lines are no part of a program.
//
//   bun test/aot/tools/same-code-wherever-the-text-stands.ts [--bun <bun>] [--jobs 16] [--show 20] [--build-flag <flag>].. <program or folder>..
//
// A program is one file, or a folder with a `main.*`. It is built as written, and once more with what ./sow-blanks-and-comments.ts sows into every file, in a folder of the same name.
// The machine code is compared function by function, byte for byte. A program can see where its text stands in two ways, the positions in a stack trace and the text of a function:
// both are data beside the code, which are not compared, and neither is what the program prints.
// It prints one line for each program that differs, with the first functions that do, and exits with 1 if there is any.
// To find the place: `sow-blanks-and-comments.ts --kinds=<kind>` sows one kind alone, `--in= --places=` at one place.
import { compareForms, compareFromCommandLine, type Comparison, type Form } from "./same-code-in-every-spelling";
import { sowFiles } from "./sow-blanks-and-comments";

export const forms: readonly Form[] = [
  { name: "as written", rewrite() {} },
  { name: "sown", rewrite: folder => void sowFiles(folder) },
];

export const compareWithSown = (bun: string, program: string, work: string, comparison: Comparison = {}) =>
  compareForms(bun, program, work, forms, { ...comparison, runs: false });

if (import.meta.main)
  await compareFromCommandLine(
    "same-code-wherever-the-text-stands.ts",
    forms,
    "THE SAME CODE WHEREVER THE TEXT STANDS",
    false,
  );
