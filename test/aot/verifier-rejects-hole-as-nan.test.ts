// A read from an array of doubles may return NaN for a hole when the program only does arithmetic on the value: undefined would become NaN in the arithmetic anyway. The walk checks every use.
// --aot-check=Validate checks again, on the function body ("the program does more with the value than arithmetic") and on the generated code ("an operation that tells NaN from undefined").
// The injected fault, --aot-testing=AssumeArithmeticElementUsers, makes the walk's own check pass whatever the uses are.
// In each program a store into another row separates two products with `held`. The versions of its read merge in a block parameter, and the second product checks that parameter for a number to
// pick its specialized version. The verifier accepts that check, but it must still reject whatever else the program does with the value.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { expectFaultyBuild } from "./harness/fault-injection";
import { withoutDebugInformation } from "./harness/without-debug-information";

const env = { ...bunEnv, NO_COLOR: "1" };
const fault = "--aot-testing=AssumeArithmeticElementUsers";
const program = (before: string, after: string) => `"use strict";
const told = [];
function turn(rows, at, sine, cosine) { let held; for (let k = 0; k < rows.length; k++) { held = rows[k][at + 1]; ${before}rows[k][at + 1] = sine * rows[k][at] + cosine * held; rows[k + 1][at] = cosine * rows[k][at] - sine * held; ${after}} }
const rows = JSON.parse("[" + Array.from({ length: 6 }, (_, r) => "[" + Array.from({ length: 5 }, (_, c) => (r * 5 + c) % 7 + 0.25).join() + "]").join() + "]");
delete rows[2][2];
delete rows[4][2];
try { turn(rows, 1, 0.6, 0.8); } catch (error) { told.push(String(error).slice(0, 9)); }
console.log(told.join());
`;
const bodyMessage = "(GetArrayElement): a hole is read as NaN and the program does more with the value than arithmetic";
const codeMessage = "(Add): a hole is read as NaN for an operation that tells NaN from undefined";

describe.skipIf(!!unsupported)("a walk that assumes every element use is arithmetic", () => {
  for (const [name, text, printed, message, isSilentlyWrong] of [
    [
      "is rejected when the program reads typeof",
      program("told.push(typeof held); ", ""),
      "number,number,undefined,number,undefined,number,TypeError\n",
      bodyMessage,
      true,
    ],
    [
      "is rejected when the program branches on typeof, like the specialization check",
      program("", 'told.push(typeof held === "number" ? "a" : "none"); '),
      "a,a,none,a,none,TypeError\n",
      bodyMessage,
      false,
    ],
    [
      "is rejected when a string is appended after the accepted number check",
      program("", 'told.push(held + ""); '),
      "2.25,0.25,undefined,3.25,undefined,TypeError\n",
      codeMessage,
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
        const outputOf = async (outfile: string) =>
          (await spawned([join(folder, isWindows ? outfile + ".exe" : outfile)], folder, env)).stdout;

        expect((await build("right", "--aot-check=Validate")).exitCode).toBe(0);
        expect(await outputOf("right")).toBe(printed);
        if (isSilentlyWrong) {
          const silent = await build("silent", fault);
          if (expectFaultyBuild(silent, message)) expect(await outputOf("silent")).not.toBe(printed);
        }
        for (const check of ["--aot-check=Validate", "--aot-harden=proof-checks"]) {
          const stopped = await build("stopped", check, fault);
          expect(stopped.stderr).toContain(message);
          expect(stopped.exitCode).toBe(1);
        }
      }),
    );
});
