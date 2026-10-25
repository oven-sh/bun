// `--trim` keeps toLocaleString and localeCompare where the program names them. A name that arrives as data names nothing: the call throws an error that says how to keep the method.
// A list or a comparison that holds the name keeps it.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { canTrim } from "../bundler/compile-trim-features";
import { built, slot, spawned, unsupported } from "./run-programs";

const removed = (name: string) =>
  `${name} was removed by --trim because your code never uses it. To keep it, add "intl" to compile.trim.allow in Bun.build().`;

const programs: [title: string, source: string, answer: string, trimmedSays: string | null][] = [
  [
    "toLocaleString under a name from the command line is removed",
    `console.log((1234567.891)[process.argv[2]]("de-DE"));`,
    "1.234.567,891",
    removed("toLocaleString"),
  ],
  [
    "localeCompare under a name from the command line is removed",
    `console.log("ä"[process.argv[3]]("z", "sv"));`,
    "1",
    removed("localeCompare"),
  ],
  [
    "a list that holds the name keeps toLocaleString",
    `const known = ["toLocaleString", "toFixed"];\nconsole.log(known.includes(process.argv[2]) ? (1234567.891)[process.argv[2]]("de-DE") : "unknown");`,
    "1.234.567,891",
    null,
  ],
  [
    "a comparison with the name keeps toLocaleString",
    `console.log(process.argv[2] === "toLocaleString" ? (1234567.891)[process.argv[2]]("de-DE") : "unknown");`,
    "1.234.567,891",
    null,
  ],
];

if (!canTrim)
  console.error(
    "SKIPPED: test/aot/trim-keeps-locale-methods-only-where-they-are-named.test.ts: this Bun was not linked for --trim",
  );

(canTrim && !unsupported && !isWindows ? describe.concurrent : describe.skip)(
  "locale methods in a trimmed executable",
  () => {
    test.each(programs)(
      "%s",
      (_, source, answer, trimmedSays) =>
        slot(async () => {
          using dir = tempDir("aot-trim-locale-methods", { "program.js": source + "\n" });
          const folder = String(dir);
          const ran: Record<string, { stdout: string; stderr: string; exitCode: number | null }> = {};
          for (const [kind, flags] of [
            ["untrimmed", []],
            ["trimmed", ["--trim"]],
          ] as const) {
            built(
              await spawned(
                [bunExe(), "build", "--compile", "--aot", ...flags, "program.js", "--outfile", kind],
                folder,
                bunEnv,
              ),
            );
            ran[kind] = await spawned([join(folder, kind), "toLocaleString", "localeCompare"], folder, bunEnv);
          }
          expect({ stdout: ran.untrimmed.stdout, exitCode: ran.untrimmed.exitCode }).toEqual({
            stdout: answer + "\n",
            exitCode: 0,
          });
          if (trimmedSays === null) return expect(ran.trimmed).toEqual(ran.untrimmed);
          expect(ran.trimmed.stderr).toContain(trimmedSays);
          expect({ stdout: ran.trimmed.stdout, exitCode: ran.trimmed.exitCode }).toEqual({ stdout: "", exitCode: 1 });
        }),
      600_000,
    );
  },
);
