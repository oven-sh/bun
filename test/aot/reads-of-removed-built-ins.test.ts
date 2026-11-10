// --trim removes code, not names: a read of any member of a built-in object answers as in the whole executable. Only a use of what was read may throw ERR_FEATURE_REMOVED.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { canTrim } from "../bundler/compile-trim-features";
import { built, slot, spawned, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { copyWithoutDebugInformation, withoutDebugInformation } from "./harness/without-debug-information";

const holders = [
  "globalThis",
  "Bun",
  "process",
  "Intl",
  "Temporal",
  "WebAssembly",
  "Buffer",
  "crypto",
  "navigator",
  "performance",
  "console",
  "Reflect",
  "Atomics",
  "Math",
  "JSON",
];

// The names of the holders and of their members are only known at run time, so nothing counts as used.
const readsEveryKey = `for (const name of process.argv.slice(2)) {
  const holder = name === "globalThis" ? globalThis : globalThis[name];
  for (const key of Reflect.ownKeys(holder)) {
    let answer;
    try {
      const value = holder[key];
      if (value instanceof Promise) value.catch(() => {});
      answer = typeof value;
    } catch (error) {
      answer = "throws " + (error.code ?? error.name);
    }
    console.log(name + "." + String(key), answer);
  }
}
process.exit(0);
`;

// What a text from run time does with a function whose code was removed.
const usesOfRemovedFunction: Record<string, string> = {
  "a call": "value()",
  "a construction": "new value()",
  "a template tag": "value`select 1`",
  "a read of a member": "value.begin",
  "a call of a member": "value.begin()",
  "a list of its keys": "Object.keys(value)",
  "a question for a member": '"begin" in value',
  "a write of a member": "value.begin = 1",
};
const usesThatAnswer: Record<string, string> = {
  "typeof": "typeof value",
  "its name and its length": "value.name + value.length",
  "await": "value.then",
  "JSON": 'JSON.stringify({ value }) + ""',
  "instanceof": 'Object(1) instanceof Bun["SQL"]',
  "the same function under both names": 'Bun["sql"] === Bun["postgres"]',
  "a conversion to a boolean": "Boolean(value)",
  "what every function inherits": "typeof value.call + typeof value.bind + typeof value.toString",
};
const evaluates = `const [, , text, holder, member] = process.argv;
const box = { self: globalThis };
const value = box[process.argv[5] ?? "self"][holder][member];
try {
  console.log(new Function("value", "return " + text)(value));
} catch (error) {
  console.log(error.code, error.message.split(" ")[0]);
}
process.exit(0);
`;

// Copies of a Bun that the program names: every member is read, and the program calls what it names. The names of the removed members come from the command line:
// a name that the program spells would keep them.
const copies: Record<string, string> = {
  "a spread": "const copy = { ...Bun };",
  "Object.assign()": "const copy = Object.assign({}, Bun);",
  "for-in": "const copy = {}; for (const key in Bun) copy[key] = Bun[key];",
  "Object.entries()": "const copy = Object.fromEntries(Object.entries(Bun));",
  "a rest pattern": "const { version, ...copy } = Bun;",
  "own keys and Reflect.get()":
    "const copy = {}; for (const key of Reflect.ownKeys(Bun)) copy[key] = Reflect.get(Bun, key);",
  "descriptors":
    "const copy = {}; for (const [key, found] of Object.entries(Object.getOwnPropertyDescriptors(Bun))) copy[key] = found.value ?? found.get?.call(Bun);",
};

const buildsWithoutSql = `const [, , entry, outfile, executablePath] = process.argv;
const result = await Bun.build({
  entrypoints: [entry],
  compile: { outfile, aot: true, trim: { remove: ["sql"] }, ...(executablePath && { executablePath }) },
});
for (const log of result.logs) console.error(String(log));
process.exit(result.success ? 0 : 1);
`;

if (!canTrim) console.error("SKIPPED: reads-of-removed-built-ins.test.ts: this build of Bun doesn't support --trim");

async function builtExecutables(folder: string, file: string) {
  const build = [bunExe(), "build", "--compile", ...withoutDebugInformation, "--aot", file, "--outfile"];
  built(await spawned([...build, "whole"], folder, bunEnv));
  built(await spawned([...build, "trimmed", "--trim"], folder, bunEnv));
}

(canTrim && !unsupported ? describe : describe.skip)("in a trimmed executable", () => {
  test(
    "a read of an own key of a built-in object answers as in the whole executable",
    () =>
      slot(async () => {
        using dir = tempDir("reads-of-removed-built-ins", { "program.js": readsEveryKey });
        const folder = String(dir);
        await builtExecutables(folder, "program.js");
        const whole = await spawned([join(folder, "whole"), ...holders], folder, bunEnv);
        const trimmed = await spawned([join(folder, "trimmed"), ...holders], folder, bunEnv);
        const answers = trimmed.stdout.split("\n");
        expect(answers.length).toBeGreaterThan(500);
        expect(answers.filter(answer => answer.includes("ERR_FEATURE_REMOVED"))).toEqual([]);
        expect(answers).toEqual(whole.stdout.split("\n"));
        expect(trimmed.exitCode).toBe(0);
      }),
    600_000,
  );

  test(
    "a function whose code was removed can be read and throws when it is used",
    () =>
      slot(async () => {
        using dir = tempDir("reads-of-removed-built-ins", { "program.js": evaluates });
        const folder = String(dir);
        built(
          await spawned(
            [
              bunExe(),
              "build",
              "--compile",
              ...withoutDebugInformation,
              "--aot",
              "--trim",
              "program.js",
              "--outfile",
              "trimmed",
            ],
            folder,
            bunEnv,
          ),
        );
        const ask = async (text: string, name: string) =>
          (await spawned([join(folder, "trimmed"), text, "Bun", name], folder, bunEnv)).stdout;
        for (const name of ["sql", "postgres", "SQL"]) {
          const api = name === "SQL" ? "Bun.SQL" : "Bun.sql";
          for (const [use, text] of Object.entries(usesOfRemovedFunction))
            expect({ name, use, answer: await ask(text, name) }).toEqual({
              name,
              use,
              answer: `ERR_FEATURE_REMOVED ${api}\n`,
            });
        }
        const answers: string[] = [];
        for (const text of Object.values(usesThatAnswer)) answers.push((await ask(text, "sql")).trim());
        expect(answers).toEqual([
          "function",
          "sql2",
          "undefined",
          "{}",
          "false",
          "true",
          "true",
          "functionfunctionfunction",
        ]);
      }),
    600_000,
  );

  test(
    "a copy of Bun has every member, and what the program names on it works",
    () =>
      slot(async () => {
        for (const [title, copy] of Object.entries(copies)) {
          using dir = tempDir("reads-of-removed-built-ins", {
            "build.mjs": buildsWithoutSql,
            "program.js": `${copy}\nconsole.log(copy.escapeHTML("<a>"), ...process.argv.slice(2).map(name => typeof copy[name]));\n`,
          });
          const folder = String(dir);
          await builtExecutables(folder, "program.js");
          const carrier = copyWithoutDebugInformation ? [copyWithoutDebugInformation] : [];
          built(
            await spawned(
              [bunExe(), "build.mjs", "./program.js", join(folder, "without-sql"), ...carrier],
              folder,
              bunEnv,
            ),
          );
          const answers: string[] = [];
          for (const name of ["whole", "trimmed", "without-sql"])
            answers.push((await spawned([join(folder, name), "sql", "SQL", "postgres"], folder, bunEnv)).stdout);
          const expected = "&lt;a&gt; function function function\n";
          expect({ title, answers }).toEqual({ title, answers: [expected, expected, expected] });
        }
      }),
    600_000,
  );
});
