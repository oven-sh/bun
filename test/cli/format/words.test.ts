// Tests for what `bun fmt` prints when there's no Prettier or oxfmt config.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

const env = { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: undefined };
const ugly = "a  ;\n";
const formatted = "a;\n";

async function format(files: Record<string, string>, args: string[], more: Record<string, string> = {}) {
  using dir = tempDir("bun-format-words", files);
  await using proc = spawn({
    cmd: [bunExe(), "fmt", ...args],
    env: { ...env, ...more },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const after = Object.keys(files).map(name => [name, readFileSync(join(String(dir), name), "utf8")]);
  return { stdout, stderr: stderr.replace(/ \[\d+(\.\d+)?m?s\]/g, ""), exitCode, files: Object.fromEntries(after) };
}

describe.concurrent("bun fmt --check", () => {
  test("lists the files that need formatting, writes nothing and exits with 1", async () => {
    const files = { "a.js": ugly, "b.js": formatted, "src/c.ts": ugly, "d.json": "{}\n" };
    expect(await format(files, ["--check"])).toEqual({
      stdout: "a.js\nsrc/c.ts\n",
      stderr: "2 files need formatting. Run bun fmt to fix them.\n",
      exitCode: 1,
      files,
    });
  });

  test("uses the singular for one file", async () => {
    const files = { "a.js": ugly, "b.js": formatted };
    expect(await format(files, ["--check"])).toEqual({
      stdout: "a.js\n",
      stderr: "1 file needs formatting. Run bun fmt to fix it.\n",
      exitCode: 1,
      files,
    });
  });

  test("exits with 0 if every file is formatted", async () => {
    const [four, one] = await Promise.all([
      format({ "a.js": formatted, "b.ts": formatted, "c.json": "{}\n", "d.css": "a {\n}\n" }, ["--check"]),
      format({ "a.js": formatted }, ["--check"]),
    ]);
    expect(four).toMatchObject({ stdout: "", stderr: "All 4 files are formatted.\n", exitCode: 0 });
    expect(one).toMatchObject({ stdout: "", stderr: "1 file is formatted.\n", exitCode: 0 });
  });

  test("files with syntax errors are counted separately", async () => {
    const { stdout, stderr, exitCode } = await format(
      { "a.js": ugly, "b.js": formatted, "broken.js": "const = 1;\n" },
      ["--check"],
    );
    expect(stdout).toBe("a.js\n");
    expect(stderr).toBe(
      "1 | const = 1;\n          ^\nerror: Variable declaration expected.\n    at broken.js:1:7\n\n" +
        "1 file needs formatting. Run bun fmt to fix it.\nCould not check 1 file.\n",
    );
    expect(exitCode).toBe(2);
  });

  test("[fmt] in bunfig.toml and an .editorconfig don't change the wording", async () => {
    const files = {
      "a.js": "a;\n",
      "b.js": "if (a) {\n    b\n}\n",
      "bunfig.toml": "[fmt]\nsemi = false\n",
      ".editorconfig": "[*]\nindent_size = 4\n",
    };
    expect(await format(files, ["--check", "a.js", "b.js"])).toMatchObject({
      stdout: "a.js\n",
      stderr: "1 file needs formatting. Run bun fmt to fix it.\n",
      exitCode: 1,
    });
  });

  test("--log-level", async () => {
    const files = { "a.js": ugly, "b.js": formatted };
    const [silent, error, warn] = await Promise.all(
      ["silent", "error", "warn"].map(level => format(files, ["--check", "--log-level", level])),
    );
    expect(silent).toMatchObject({ stdout: "", stderr: "", exitCode: 1 });
    expect(error).toMatchObject({ stdout: "", stderr: "", exitCode: 1 });
    expect(warn).toMatchObject({
      stdout: "a.js\n",
      stderr: "1 file needs formatting. Run bun fmt to fix it.\n",
      exitCode: 1,
    });
  });

  test("colored output has the same text", async () => {
    const files = { "a.js": ugly, "b.js": formatted };
    const [plain, colored] = await Promise.all([
      format(files, ["--check"]),
      format(files, ["--check"], { FORCE_COLOR: "1" }),
    ]);
    expect(colored.stderr).toContain("\x1b[");
    expect(Bun.stripANSI(colored.stderr)).toBe(plain.stderr);
    expect(colored.stdout).toBe(plain.stdout);
  });

  test.each([
    ["a .prettierrc", { ".prettierrc": "{}\n" }, []],
    ["prettier in package.json", { "package.json": `{ "prettier": {} }` }, []],
    ["--config", { "mine.json": "{}\n" }, ["--config", "mine.json"]],
    ["--flavor prettier", {}, ["--flavor", "prettier"]],
  ])("with %s the output is worded like Prettier's", async (_, configuration, flags) => {
    const [different, same] = await Promise.all([
      format({ ...configuration, "a.js": ugly, "b.js": ugly }, [...flags, "--check", "a.js", "b.js"]),
      format({ ...configuration, "a.js": formatted }, [...flags, "--check", "a.js"]),
    ]);
    expect(different).toMatchObject({
      stdout: "Checking formatting...\n",
      stderr: "[warn] a.js\n[warn] b.js\n[warn] Code style issues found in 2 files. Run bun fmt to fix.\n",
      exitCode: 1,
    });
    expect(same).toMatchObject({
      stdout: "Checking formatting...\nAll matched files use Prettier code style!\n",
      stderr: "",
      exitCode: 0,
    });
  });
});

describe.concurrent("bun fmt", () => {
  test("errors start with `error:`, with a .prettierrc too", async () => {
    const [missing, ofPrettier] = await Promise.all([
      format({ "a.js": formatted }, ["nothing.js"]),
      format({ "a.js": formatted, ".prettierrc": "{}\n" }, ["nothing.js"]),
    ]);
    expect(missing.stderr).toStartWith('error: No files matching the pattern were found: "nothing.js".\n');
    expect(missing.exitCode).toBe(2);
    expect(ofPrettier.stderr).toStartWith('error: No files matching the pattern were found: "nothing.js".\n');
    expect(ofPrettier.exitCode).toBe(2);
  });

  test("errors and warnings about flags get the same prefixes", async () => {
    const flags = ["--plugin", "prettier-plugin-x"];
    const [refused, allowed, ofPrettier] = await Promise.all([
      format({ "a.js": formatted }, flags),
      format({ "a.js": formatted }, [...flags, "--allow-unsupported"]),
      format({ "a.js": formatted, ".prettierrc": "{}\n" }, flags),
    ]);
    expect(refused.stderr).toStartWith("error: bun fmt does not include the plugin prettier-plugin-x\n");
    expect(allowed.stderr).toStartWith("warn: --plugin has no effect ");
    expect(ofPrettier.stderr).toStartWith("error: bun fmt does not include the plugin prettier-plugin-x\n");
    expect([refused.exitCode, allowed.exitCode, ofPrettier.exitCode]).toEqual([2, 0, 2]);
  });

  test("lists the files it writes and counts them", async () => {
    const { stdout, stderr, exitCode, files } = await format({ "a.js": ugly, "b.js": formatted, "c.js": ugly }, []);
    expect(stdout).toBe("a.js\nc.js\n");
    expect(stderr).toBe("Formatted 2 files, 1 unchanged\n");
    expect(files).toEqual({ "a.js": formatted, "b.js": formatted, "c.js": formatted });
    expect(exitCode).toBe(0);
  });

  test("--check --write writes files like a plain run", async () => {
    const { stdout, stderr, exitCode, files } = await format({ "a.js": ugly, "b.js": formatted }, [
      "--check",
      "--write",
    ]);
    expect(stdout).toBe("a.js\n");
    expect(stderr).toBe("Formatted 1 file, 1 unchanged\n");
    expect(files).toEqual({ "a.js": formatted, "b.js": formatted });
    expect(exitCode).toBe(0);
  });
});
