// Tests for `bun lint --init` and `bun fmt --init`.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

// Disable AI agent and CI detection regardless of the environment the tests run in.
const env = {
  ...bunEnv,
  AGENT: "0",
  CLAUDECODE: undefined,
  REPL_ID: undefined,
  GITHUB_ACTIONS: undefined,
  NO_COLOR: "1",
  FORCE_COLOR: undefined,
  ESLINT_USE_FLAT_CONFIG: undefined,
};

type Command = "lint" | "fmt";

async function run(cwd: string, command: Command, ...args: string[]) {
  await using proc = spawn({ cmd: [bunExe(), command, ...args], env, cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const sections = {
  lint: `[lint]
# typeAware = true   # also run the rules that need types

[lint.rules]
# "no-console" = "warn"
# "eqeqeq" = ["error", "smart"]
`,
  fmt: `[fmt]
# printWidth = 100
# semi = false
`,
};

const utf16 = (text: string) => Buffer.from("﻿" + text, "utf16le").toString("latin1");

describe.concurrent.each(["lint", "fmt"] as const)("bun %s --init", command => {
  const section = sections[command];
  const other = command === "lint" ? "fmt" : "lint";

  test("creates bunfig.toml", async () => {
    using dir = tempDir("bun-init-section", { "a.js": "a;\n" });
    expect(await run(String(dir), command, "--init")).toEqual({
      stdout: `Created bunfig.toml with a [${command}] section\n`,
      stderr: "",
      exitCode: 0,
    });
    expect(readFileSync(join(String(dir), "bunfig.toml"), "utf8")).toBe(section);
    expect(readdirSync(String(dir)).sort()).toEqual(["a.js", "bunfig.toml"]);
    expect(await run(String(dir), command, "--init")).toEqual({
      stdout: `bunfig.toml already has a [${command}] section\n`,
      stderr: "",
      exitCode: 0,
    });
    expect(readFileSync(join(String(dir), "bunfig.toml"), "utf8")).toBe(section);
  });

  // File contents are written as bytes, one latin1 character per byte.
  test.each<[string, string, string]>([
    ["a line break at the end", '[install]\nregistry = "a"\n', "\n" + section],
    ["none", '[install]\nregistry = "a"', "\n\n" + section],
    ["an empty line at the end", "[install]\n\n", section],
    ["two", "[install]\n\n\n", section],
    ["spaces at the end", "[install]\n  ", "\n" + section],
    ["a comment at the end", "# [install]", "\n\n" + section],
    ["nothing", "", section],
    ["an empty line", "\n", section],
    ["a space", " ", "\n" + section],
    ["CRLF", "[install]\r\nauto = 'auto'\r\n", ("\n" + section).replaceAll("\n", "\r\n")],
    ["CRLF, and none at the end", "a = 1\r\nb = 2", ("\n\n" + section).replaceAll("\n", "\r\n")],
    ["CRLF after LF", "a = 1\nb = 2\r\n", "\n" + section],
    ["a byte order mark", "ï»¿a = 1\n", "\n" + section],
    ["UTF-16", utf16("a = 'é'\r\n"), utf16(("\n" + section).replaceAll("\n", "\r\n")).slice(2)],
    ["more than ASCII", Buffer.from("a = 'é→𝒳'\n").toString("latin1"), "\n" + section],
    ["the name in a comment", `# [${command}]\n`, "\n" + section],
    ["the name in a string", `a = """\n[${command}]\n"""\n`, "\n" + section],
    ["the name in another table", `[install.${command}]\n`, "\n" + section],
    ["the section of the other command", sections[other], "\n" + section],
  ])("adds the section to a bunfig.toml with %s", async (_, before, added) => {
    using dir = tempDir("bun-init-section", { "a.js": "a;\n" });
    const path = join(String(dir), "bunfig.toml");
    writeFileSync(path, before, "latin1");
    expect(await run(String(dir), command, "--init")).toEqual({
      stdout: `Added [${command}] to bunfig.toml\n`,
      stderr: "",
      exitCode: 0,
    });
    expect(readFileSync(path, "latin1")).toBe(before + added);
    // The result still parses, and the new section is found.
    expect(await run(String(dir), command, "--init")).toEqual({
      stdout: `bunfig.toml already has a [${command}] section\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  const key = command === "lint" ? "typeAware" : "useTabs";
  test.each([
    `[${command}]\n`,
    `[ ${command} ]`,
    `["${command}"]\n`,
    `${command}.${key} = true\n`,
    `${command} = { ${key} = true }\n`,
    `a = 1\r\n\r\n[${command}] # here\r\n${key} = false`,
    ...(command === "lint" ? ['[lint.rules]\n"no-var" = "error"\n', "[lint.globals]\n"] : []),
  ])("leaves a bunfig.toml with %j unchanged", async before => {
    using dir = tempDir("bun-init-section", { "bunfig.toml": before });
    expect(await run(String(dir), command, "--init")).toEqual({
      stdout: `bunfig.toml already has a [${command}] section\n`,
      stderr: "",
      exitCode: 0,
    });
    expect(readFileSync(join(String(dir), "bunfig.toml"), "utf8")).toBe(before);
  });

  test.each([
    [`[${command}\n`, `bunfig.toml:1:${command.length + 2}`],
    ["a = 1\nb = \n", "bunfig.toml:2:5"],
    [`[${command}]\nnothing = 1\n`, "bunfig.toml:2:1"],
    [`${command} = 1\n`, `bunfig.toml:1:${command.length + 4}`],
  ])("an invalid bunfig.toml is an error and is left unchanged: %j", async (before, place) => {
    using dir = tempDir("bun-init-section", { "bunfig.toml": before });
    const result = await run(String(dir), command, "--init");
    expect(result.stderr).toContain("error: ");
    expect(result.stderr).toContain(place);
    expect({ ...result, stderr: "" }).toEqual({ stdout: "", stderr: "", exitCode: 2 });
    expect(readFileSync(join(String(dir), "bunfig.toml"), "utf8")).toBe(before);
  });

  // `--config` makes Bun read another file, but `--init` always edits the bunfig.toml in the working directory.
  test("an invalid bunfig.toml is also an error with `bun --config=<path>`", async () => {
    using dir = tempDir("bun-init-section", { "bunfig.toml": "a = 1\nb = \n", "other.toml": "" });
    await using proc = spawn({
      cmd: [bunExe(), "--config=other.toml", command, "--init"],
      env,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toStartWith("error: Cannot read bunfig.toml: ");
    expect(stderr).toEndWith("\n  at bunfig.toml:2:5\n");
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 2 });
    expect(readFileSync(join(String(dir), "bunfig.toml"), "utf8")).toBe("a = 1\nb = \n");
  });

  const cannotBeKeptFromWriting = isWindows || process.getuid?.() === 0;

  test.skipIf(cannotBeKeptFromWriting)("a read-only bunfig.toml is an error", async () => {
    using dir = tempDir("bun-init-section", { "bunfig.toml": "a = 1\n" });
    chmodSync(join(String(dir), "bunfig.toml"), 0o444);
    expect(await run(String(dir), command, "--init")).toEqual({
      stdout: "",
      stderr: expect.stringMatching(/^error: Cannot write bunfig\.toml: EACCES: .+\n$/),
      exitCode: 2,
    });
    expect(readFileSync(join(String(dir), "bunfig.toml"), "utf8")).toBe("a = 1\n");
    expect(readdirSync(String(dir))).toEqual(["bunfig.toml"]);
  });

  test.skipIf(cannotBeKeptFromWriting)("an unreadable bunfig.toml is an error", async () => {
    using dir = tempDir("bun-init-section", { "bunfig.toml": "a = 1\n" });
    chmodSync(join(String(dir), "bunfig.toml"), 0o200);
    expect(await run(String(dir), command, "--init")).toEqual({
      stdout: "",
      stderr: expect.stringMatching(/^error: Cannot read bunfig\.toml: EACCES: .+\n$/),
      exitCode: 2,
    });
    chmodSync(join(String(dir), "bunfig.toml"), 0o644);
    expect(readFileSync(join(String(dir), "bunfig.toml"), "utf8")).toBe("a = 1\n");
  });

  test.skipIf(cannotBeKeptFromWriting)("in a read-only directory, only creating bunfig.toml fails", async () => {
    using dir = tempDir("bun-init-section", { "none/a.js": "a;\n", "one/bunfig.toml": "a = 1\n" });
    const [none, one] = [join(String(dir), "none"), join(String(dir), "one")];
    chmodSync(none, 0o555);
    chmodSync(one, 0o555);
    try {
      expect(await run(none, command, "--init")).toEqual({
        stdout: "",
        stderr: expect.stringMatching(/^error: Cannot write bunfig\.toml: EACCES: .+\n$/),
        exitCode: 2,
      });
      // An existing bunfig.toml is still writable.
      expect(await run(one, command, "--init")).toEqual({
        stdout: `Added [${command}] to bunfig.toml\n`,
        stderr: "",
        exitCode: 0,
      });
      expect(readFileSync(join(one, "bunfig.toml"), "utf8")).toBe("a = 1\n\n" + section);
    } finally {
      chmodSync(none, 0o755);
      chmodSync(one, 0o755);
    }
  });

  test("a directory called bunfig.toml is an error", async () => {
    using dir = tempDir("bun-init-section", { "bunfig.toml/a.js": "a;\n" });
    expect(await run(String(dir), command, "--init")).toEqual({
      stdout: "",
      stderr: expect.stringMatching(/^error: Cannot read bunfig\.toml: E[A-Z]+: .+\n$/),
      exitCode: 2,
    });
  });

  const flavor = command === "lint" ? "oxlint" : "oxfmt";
  test(`--flavor=${flavor} isn't saved to bunfig.toml`, async () => {
    using dir = tempDir("bun-init-section", { "a.js": "a;\n" });
    expect(await run(String(dir), command, "--init", `--flavor=${flavor}`)).toEqual({
      stdout: `Created bunfig.toml with a [${command}] section\n`,
      stderr: "",
      exitCode: 0,
    });
    expect(readFileSync(join(String(dir), "bunfig.toml"), "utf8")).toBe(section);
    expect(readdirSync(String(dir)).sort()).toEqual(["a.js", "bunfig.toml"]);
  });
});

describe.concurrent("writes nothing if another tool's config file is in use", () => {
  const flat = "export default [];\n";
  test.each<[Command, Record<string, string>, string[], string]>([
    ["lint", { "eslint.config.js": flat }, [], "eslint.config.js"],
    ["lint", { "eslint.config.mjs": flat, "sub/a.js": "" }, ["--cwd", "sub"], "../eslint.config.mjs"],
    ["lint", { ".eslintrc.json": "{}" }, [], ".eslintrc.json"],
    ["lint", { "package.json": '{ "eslintConfig": {} }' }, [], "eslintConfig in package.json"],
    ["lint", { ".oxlintrc.json": "{}" }, [], ".oxlintrc.json"],
    ["lint", { ".oxlintrc.json": "{}", "sub/a.js": "" }, ["--cwd", "sub"], "../.oxlintrc.json"],
    ["lint", { "config/mine.mjs": flat }, ["-c", "config/mine.mjs"], "config/mine.mjs"],
    ["lint", { "eslint.config.js": flat, ".oxlintrc.json": "{}" }, ["--flavor=oxlint"], ".oxlintrc.json"],
    ["lint", { "eslint.config.js": flat, ".oxlintrc.json": "{}" }, ["--flavor=eslint"], "eslint.config.js"],
    ["fmt", { ".prettierrc": "{}" }, [], ".prettierrc"],
    ["fmt", { ".prettierrc.toml": "semi = false\n", "sub/a.js": "" }, ["--cwd", "sub"], "../.prettierrc.toml"],
    ["fmt", { "package.json": '{ "prettier": {} }' }, [], "prettier in package.json"],
    ["fmt", { ".oxfmtrc.json": "{}" }, [], ".oxfmtrc.json"],
    ["fmt", { ".oxfmtrc.jsonc": "{}", "sub/a.js": "" }, ["--cwd", "sub"], "../.oxfmtrc.jsonc"],
    ["fmt", { "config/mine.json": "{}" }, ["--config", "config/mine.json"], "config/mine.json"],
  ])("bun %s: %j %j", async (command, files, args, shown) => {
    using dir = tempDir("bun-init-section", files);
    expect(await run(String(dir), command, "--init", ...args)).toEqual({
      stdout: `Using ${shown}. bunfig.toml is not needed.\n`,
      stderr: "",
      exitCode: 0,
    });
    const found = new Bun.Glob("**").scanSync({ cwd: String(dir), dot: true });
    expect([...found].map(it => it.replaceAll("\\", "/")).sort()).toEqual(Object.keys(files).sort());
  });

  test.each<[Command, Record<string, string>]>([
    ["lint", { "package.json": '{ "devDependencies": { "eslint": "10.0.0" } }' }],
    ["lint", { "package.json": '{ "devDependencies": { "oxlint": "1.0.0" } }' }],
    ["lint", { "eslint.config.js": flat, "args": "--flavor=oxlint" }],
    ["lint", { "eslint.config.js": flat, "args": "--no-config-lookup" }],
    ["fmt", { "package.json": '{ "devDependencies": { "prettier": "3.0.0" } }' }],
    ["fmt", { ".editorconfig": "root = true\n" }],
    ["fmt", { ".prettierrc": "{}", "args": "--no-config" }],
  ])("still writes bunfig.toml, bun %s: %j", async (command, { args, ...files }) => {
    using dir = tempDir("bun-init-section", files);
    const result = await run(String(dir), command, "--init", ...(args ? [args] : []));
    expect(result.stdout).toBe(`Created bunfig.toml with a [${command}] section\n`);
    expect(result.exitCode).toBe(0);
  });

  test("a broken config file is an error", async () => {
    using dir = tempDir("bun-init-section", { "eslint.config.js": "throw new Error('no');\n", ".prettierrc": "{" });
    for (const command of ["lint", "fmt"] as const) {
      const result = await run(String(dir), command, "--init");
      expect(result.stderr).toContain(command === "lint" ? "eslint.config.js" : ".prettierrc");
      expect({ stdout: result.stdout, exitCode: result.exitCode }).toEqual({ stdout: "", exitCode: 2 });
    }
    expect(existsSync(join(String(dir), "bunfig.toml"))).toBe(false);
  });
});

// Uncomments each commented-out line, one at a time and then all together.
describe.concurrent("the commented-out lines work when uncommented", () => {
  const commented = (text: string) => text.split("\n").flatMap((line, at) => (line.startsWith("# ") ? [at] : []));
  const variants = (text: string) =>
    [[], ...commented(text).map(at => [at]), commented(text)].map(lines => {
      const all = text.split("\n");
      const keys = lines.map(at => all[at].slice(2).split(" ")[0]);
      return [keys, all.map((line, at) => (lines.includes(at) ? line.slice(2) : line)).join("\n")] as const;
    });

  const rules: Record<string, { id: string; exitCode: number }> = {
    typeAware: { id: "@typescript-eslint/no-floating-promises", exitCode: 1 },
    '"no-console"': { id: "no-console", exitCode: 0 },
    '"eqeqeq"': { id: "eqeqeq", exitCode: 1 },
  };
  test.each(variants(sections.lint))("bun lint: %j", async (keys, bunfig) => {
    using dir = tempDir("bun-init-section", {
      "a.ts": "export function f(a: number) {\n  console.log(a == 1);\n  return Promise.resolve();\n}\nf(1);\n",
      "tsconfig.json": "{}",
      "bunfig.toml": bunfig,
    });
    const result = await run(String(dir), "lint", "-f", "json");
    const found = JSON.parse(result.stdout).flatMap((it: { messages: { ruleId: string }[] }) =>
      it.messages.map(it => it.ruleId),
    );
    expect(found.sort()).toEqual(keys.map(key => rules[key].id).sort());
    expect(result.exitCode).toBe(Math.max(0, ...keys.map(key => rules[key].exitCode)));
  });

  const names = Array.from({ length: 8 }, (_, at) => `argument${at}`);
  test.each(variants(sections.fmt))("bun fmt: %j", async (keys, bunfig) => {
    expect(["printWidth", "semi"]).toEqual(expect.arrayContaining([...keys]));
    using dir = tempDir("bun-init-section", { "a.js": `call(${names.join(",")})\n`, "bunfig.toml": bunfig });
    const result = await run(String(dir), "fmt", "a.js");
    const call = keys.includes("printWidth")
      ? `call(${names.join(", ")})`
      : `call(\n${names.map(name => `  ${name},\n`).join("")})`;
    expect(readFileSync(join(String(dir), "a.js"), "utf8")).toBe(call + (keys.includes("semi") ? "\n" : ";\n"));
    expect(result.exitCode).toBe(0);
  });
});
