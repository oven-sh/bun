// A test file that can't be compiled fails by itself, as a file that can't be loaded does under `bun test`. What a CI reads has to say so: the counts, the exit code and the
// JUnit report, where plain Bun writes such a file as a failed case named "(unhandled error)". The words of the error are the compiler's.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { test as oneAtATime } from "./supported";

raiseDefaultTimeout(120_000);

const test = oneAtATime.concurrent;

const passes = {
  "a.test.js": `import { test, expect } from "bun:test";\ntest("passes", () => { expect(1).toBe(1); });\n`,
};

const cases = {
  "a syntax error": { ...passes, "b.test.js": `const broken = ;\n` },
  "an import of a name that the file doesn't export": {
    ...passes,
    "b.test.js": `import { test } from "bun:test";\nimport { nope } from "./dep.js";\ntest("never", () => void nope);\n`,
    "dep.js": `export const there = 1;\n`,
  },
  "a syntax error in the only test file": { "b.test.js": `const broken = ;\n` },
};

const forms = [
  ["as one program", "TestRunLayers:0", []],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1", []],
  ["in parallel", "", ["--parallel=2"]],
] as const;

async function report(folder: string, words: string, ...flags: string[]) {
  const outfile = join(folder, `report-${flags.join("")}-${words.replace(/\W/g, "")}.xml`);
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, "--reporter=junit", `--reporter-outfile=${outfile}`],
    cwd: folder,
    env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  const xml = existsSync(outfile) ? readFileSync(outfile, "utf8") : "no report";
  const attributes = /\b(?:name|file|tests|failures|skipped)="[^"]*"/g;
  return {
    exitCode,
    counts: (out + err)
      .split("\n")
      .flatMap(line => /^ *\d+ (?:pass|fail|error)$|^Ran \d+ tests? across \d+ files?/.exec(line) ?? []),
    elements: [...xml.matchAll(/<(testsuites|testsuite|testcase|failure)\b[^>]*>/g)].map(
      ([element, kind]) => `${kind} ${kind === "failure" ? "" : (element.match(attributes) ?? []).join(" ")}`,
    ),
    messages: [...xml.matchAll(/<failure type="([^"]*)" message="([^"]*)"/g)].map(
      ([, type, message]) => `${type}: ${message}`,
    ),
  };
}

for (const [title, files] of Object.entries(cases)) {
  test(title, async () => {
    const folder = String(tempDir("aot-unloadable-file", files));
    const { messages: _, ...plain } = await report(folder, "");
    expect(plain.elements.join("\n")).toContain(`testcase name="(unhandled error)" file="b.test.js"`);
    for (const [form, words, flags] of forms) {
      const { messages, ...compiled } = await report(folder, words, "--aot", ...flags);
      expect({ form, ...compiled }).toEqual({ form, ...plain });
      // A part leaves such a file to the loader, which says what it says under `bun test`.
      const said = expect.stringMatching(/^(?:BuildMessage: TS\d+|SyntaxError): ./);
      expect({ form, messages }).toEqual({ form, messages: [said] });
    }
  });
}
