// TOML under a configuration file of oxfmt. What is printed for which text is in `own/cases/toml`, judged by oxfmt.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

async function format(files: Record<string, string>, config: object, args: string[] = []) {
  using dir = tempDir("bun-format-toml", { ...files, ".oxfmtrc.json": JSON.stringify(config) });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "format", ...args],
    env: { ...bunEnv, NO_COLOR: "1" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);
  const after = Object.keys(files).map(name => [name, readFileSync(join(String(dir), name), "utf8")]);
  return { files: Object.fromEntries(after), stderr, exitCode };
}

test.concurrent("printWidth, useTabs, trailingComma and endOfLine count", async () => {
  const config = { printWidth: 20, useTabs: true, trailingComma: "none", endOfLine: "crlf" };
  const result = await format({ "a.toml": 'a = ["aaaaaaaa", "bbbbbbbb"]\n' }, config);
  expect(result.files["a.toml"]).toBe('a = [\r\n\t"aaaaaaaa",\r\n\t"bbbbbbbb"\r\n]\r\n');
  expect(result.exitCode).toBe(0);
});

test.concurrent(
  "a file with \\r\\n is read as one with \\n, but a string of several lines stays as it is written",
  async () => {
    const text = 'a = 1\r\n\r\n\r\n\r\n\r\nb   = [\r\n 1, # c\r\n 2\r\n]\r\ns = """\r\nx\r\n"""\r\n';
    const lf = await format({ "a.toml": text }, {});
    expect(lf.files["a.toml"]).toBe('a = 1\n\n\nb = [\n  1, # c\n  2,\n]\ns = """\r\nx\r\n"""\n');
    const crlf = await format({ "a.toml": text }, { endOfLine: "crlf" });
    expect(crlf.files["a.toml"]).toBe('a = 1\r\n\r\n\r\nb = [\r\n  1, # c\r\n  2,\r\n]\r\ns = """\r\nx\r\n"""\r\n');
  },
);

test.concurrent("the names that oxfmt takes for TOML, and the lock files that it never touches", async () => {
  const names = ["a.toml", "b.toml.example", "Pipfile", "Cargo.toml.orig"];
  const locks = ["Cargo.lock", "Gopkg.lock", "pdm.lock", "poetry.lock", "uv.lock"];
  const result = await format(Object.fromEntries([...names, ...locks].map(name => [name, "a   = 1\n"])), {});
  expect(result.files).toEqual(
    Object.fromEntries([...names.map(name => [name, "a = 1\n"]), ...locks.map(name => [name, "a   = 1\n"])]),
  );
  expect(result.exitCode).toBe(0);
});

test.concurrent("numbers, dates, strings and keys stay as they are written, whatever their size", async () => {
  const text =
    'big   = 123456789012345678901234567890\nhex=0xDEAD_beef\n"a b" . \'c\'=1979-05-27 07:32:00.123456789123\ns = "\\u00e9\\t"\n';
  const result = await format({ "a.toml": text }, {});
  expect(result.files["a.toml"]).toBe(
    'big = 123456789012345678901234567890\nhex = 0xDEAD_beef\n"a b".\'c\' = 1979-05-27 07:32:00.123456789123\ns = "\\u00e9\\t"\n',
  );
  expect(result.exitCode).toBe(0);
});

test.concurrent("what is nested too deeply is left as it is, and that is said", async () => {
  const files = {
    "ok.toml": `a   = ${"[".repeat(128)}${"]".repeat(128)}\n`,
    "deep.toml": `a   = ${"[".repeat(129)}${"]".repeat(129)}\n`,
    "huge.toml": `a   = ${"[".repeat(200_000)}${"]".repeat(200_000)}\n`,
  };
  const result = await format(files, { printWidth: 320 });
  expect(result.files).toEqual({ ...files, "ok.toml": files["ok.toml"].replace("a   =", "a =") });
  expect(result.stderr).toContain("[error] deep.toml:");
  expect(result.stderr).toContain("[error] huge.toml:");
  expect(result.exitCode).toBe(2);
});
