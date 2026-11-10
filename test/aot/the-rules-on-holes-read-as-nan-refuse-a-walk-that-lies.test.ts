// A read off a list of fractions may take NaN for a hole where the program only reckons with the value: undefined would become NaN in the arithmetic anyway. The walk asks that of every user.
// --aot-check=Validate asks it again: of the body ("the program does more with the value than arithmetic") and of the code ("an operation that tells NaN from undefined").
// THE LIE: --aot-testing=AssumeArithmeticElementUsers: the walk's own question answers yes whatever the users are.
// In each program the store into another row stands between two products with `held`, so the arms of its read meet in a parameter and the second product tests that parameter for a number to
// choose its form. The check lets such a test pass; what the program does with the value besides must still be refused.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { withoutDebugInformation } from "./harness/without-debug-information";

const env = { ...bunEnv, NO_COLOR: "1" };
const lie = "--aot-testing=AssumeArithmeticElementUsers";
const program = (inFront: string, behind: string) => `"use strict";
const told = [];
function turn(rows, at, sine, cosine) { let held; for (let k = 0; k < rows.length; k++) { held = rows[k][at + 1]; ${inFront}rows[k][at + 1] = sine * rows[k][at] + cosine * held; rows[k + 1][at] = cosine * rows[k][at] - sine * held; ${behind}} }
const rows = JSON.parse("[" + Array.from({ length: 6 }, (_, r) => "[" + Array.from({ length: 5 }, (_, c) => (r * 5 + c) % 7 + 0.25).join() + "]").join() + "]");
delete rows[2][2];
delete rows[4][2];
try { turn(rows, 1, 0.6, 0.8); } catch (error) { told.push(String(error).slice(0, 9)); }
console.log(told.join());
`;
const ofTheBody = "(GetArrayElement): a hole is read as NaN and the program does more with the value than arithmetic";
const ofTheCode = "(Add): a hole is read as NaN for an operation that tells NaN from undefined";

describe.skipIf(!!unsupported)("a walk that takes every user of an element to reckon with it", () => {
  for (const [name, text, printed, words, isWrongInSilence] of [
    [
      "is refused where the program asks typeof",
      program("told.push(typeof held); ", ""),
      "number,number,undefined,number,undefined,number,TypeError\n",
      ofTheBody,
      true,
    ],
    [
      "is refused where the program chooses by typeof, as the walk does for the form of a product",
      program("", 'told.push(typeof held === "number" ? "a" : "none"); '),
      "a,a,none,a,none,TypeError\n",
      ofTheBody,
      false,
    ],
    [
      "is refused where a text is added behind the test for numbers that the check lets pass",
      program("", 'told.push(held + ""); '),
      "2.25,0.25,undefined,3.25,undefined,TypeError\n",
      ofTheCode,
      false,
    ],
  ] as const)
    test(name, () =>
      slot(async () => {
        using dir = tempDir("aot-holes-read-as-nan", { "main.cjs": text });
        const folder = String(dir);
        const build = (outfile: string, ...flags: string[]) =>
          spawned(
            [
              bunExe(),
              "build",
              "--compile",
              "--aot",
              ...withoutDebugInformation,
              ...flags,
              "./main.cjs",
              "--outfile",
              outfile,
            ],
            folder,
            env,
          );
        const said = async (outfile: string) =>
          (await spawned([join(folder, isWindows ? outfile + ".exe" : outfile)], folder, env)).stdout;

        expect((await build("right", "--aot-check=Validate")).exitCode).toBe(0);
        expect(await said("right")).toBe(printed);
        if (isWrongInSilence) {
          const silent = await build("silent", lie);
          // A Bun built with assertions or a sanitizer always runs the check, so it rejects this build too.
          if (isASAN || isDebug) {
            expect(silent.stderr).toContain(words);
            expect(silent.exitCode).toBe(1);
          } else {
            expect(silent.exitCode).toBe(0);
            expect(await said("silent")).not.toBe(printed);
          }
        }
        const stopped = await build("stopped", "--aot-check=Validate", lie);
        expect(stopped.stderr).toContain(words);
        expect(stopped.exitCode).toBe(1);
      }),
    );
});
