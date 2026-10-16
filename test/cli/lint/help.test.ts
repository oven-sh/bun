import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

const root = join(import.meta.dir, "../../..");

async function runIn(files: Record<string, string>, ...args: string[]) {
  using dir = tempDir("bun-lint-help", files);
  await using proc = Bun.spawn({ cmd: [bunExe(), ...args], env: bunEnv, cwd: String(dir), stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const run = (...args: string[]) => runIn({}, ...args);

/** Maps each flag listed in a help text (by its long name) to its description. */
const listed = (help: string): Record<string, string> =>
  Object.fromEntries([...help.matchAll(/^ {2}(?:-\w,| {3}) --([\w-]+)(?:=<val>)? +(.+)$/gm)].map(it => [it[1], it[2]]));

describe.concurrent.each([
  {
    command: "lint",
    source: "src/lint/driver/cli.rs",
    common: [
      "fix",
      "staged",
      "changed",
      "rule",
      "rules",
      "explain",
      "type-aware",
      "quiet",
      "max-warnings",
      "init",
      "doctor",
    ],
    headings: [
      "Rules",
      "Files",
      "Output",
      "Fixing",
      "Types",
      "Other",
      "Compatibility with ESLint",
      "Compatibility with oxlint",
    ],
  },
  {
    command: "fmt",
    source: "src/lint/driver/fmt/cli.rs",
    common: [
      "check",
      "staged",
      "changed",
      "stdin-filepath",
      "print-width",
      "use-tabs",
      "no-semi",
      "single-quote",
      "init",
      "doctor",
    ],
    headings: ["Options", "Files", "Output", "Other", "Compatibility with Prettier", "Compatibility with oxfmt"],
  },
])("bun $command", ({ command, source, common, headings }) => {
  test("--help is short", async () => {
    const { stdout, stderr, exitCode } = await run(command, "--help");
    const lines = stdout.trimEnd().split("\n");
    expect(lines[0]).toBe(`Usage: bun ${command} [flags] [...files, directories or patterns]`);
    expect(stdout.match(/^\S.*:$/gm)).toEqual(["Flags:", "Examples:"]);
    expect(Object.keys(listed(stdout))).toEqual(common);
    expect(lines.filter(line => line.startsWith(`  bun ${command}`))).toHaveLength(3);
    expect(lines.slice(-2)).toEqual([
      `Full documentation is available at https://bun.com/docs/${command === "fmt" ? "format" : command}`,
      `See every flag with bun ${command} --help --all`,
    ]);
    expect(lines.length).toBeLessThanOrEqual(25);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("--help --all lists every flag the command accepts", async () => {
    const { stdout, stderr, exitCode } = await run(command, "--help", "--all");
    expect(stdout.match(/^\S.*:$/gm)).toEqual([...headings.map(heading => `${heading}:`), "Examples:"]);
    const params = readFileSync(join(root, source), "utf8").matchAll(/clap::param!\(\s*"(?:-\w, )?(--[^\s"]+)/g);
    const taken = [...params].flatMap(it => it[1].split("/"));
    expect(taken.length).toBeGreaterThan(70);
    const mentioned = new Set(stdout.match(/--[\w-]+/g));
    // Listing `--no-semi` covers `--semi` too.
    const missing = taken.filter(flag => !mentioned.has(flag) && !mentioned.has(flag.replace("--", "--no-")));
    expect(missing).toEqual([]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("--help and --help --all describe a flag the same way", async () => {
    const [short, all] = await Promise.all([run(command, "--help"), run(command, "--help", "--all")]);
    expect(listed(all.stdout)).toMatchObject(listed(short.stdout));
  });

  test.each([["--help-all"], ["--all", "--help"], ["-h", "--all"]])("%s %s is --help --all", async (...args) => {
    const [one, other] = await Promise.all([run(command, ...args), run(command, "--help", "--all")]);
    expect(one).toEqual(other);
  });

  test.each(["--help", "-h", "--help-all"])("%s isn't passed to a package.json script of that name", async flag => {
    const files = { "package.json": JSON.stringify({ scripts: { [command]: "echo the script" } }) };
    const [here, elsewhere] = await Promise.all([runIn(files, command, flag), run(command, flag)]);
    expect(here.stdout).toBe(
      `${elsewhere.stdout}
note: package.json has a "${command}" script, so bun ${command} runs that script
  Change the script to "bun ${command}" to use the built-in command
`,
    );
    expect(here.exitCode).toBe(0);
  });

  // ESLint, oxlint, Prettier and other tools behind such scripts have these flags too.
  test.each([
    ["--init"],
    ["--rules"],
    ["--print-config", "a.js"],
    ["--print-config=a.js"],
    ["--version"],
    ["-v"],
    ["-V"],
    ["src", "-v"],
    ...(command === "fmt" ? [["--explain", "no-var"], ["--explain=no-var"]] : []),
  ])("%s %s is passed to a package.json script of that name, and its exit code counts", async (...args) => {
    const files = { "package.json": JSON.stringify({ scripts: { [command]: "echo the script && exit 3 && echo" } }) };
    const { stdout, exitCode } = await runIn(files, command, ...args);
    expect(stdout).toBe("the script\n");
    expect(exitCode).toBe(3);
  });

  test.each(["--help", "-h"])("bun %s <command> prints the help and touches no file", async flag => {
    using dir = tempDir("bun-help-before", { "a.js": "const   a=1\n" });
    await using proc = Bun.spawn({ cmd: [bunExe(), flag, command], env: bunEnv, cwd: String(dir), stderr: "pipe" });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe((await run(command, "--help")).stdout);
    expect(readFileSync(join(String(dir), "a.js"), "utf8")).toBe("const   a=1\n");
    expect(exitCode).toBe(0);
  });

  test("flags of the command that stand before it count", async () => {
    const [flags, text, after, code] =
      command === "fmt"
        ? [["--check", "-c", "--list-different", "-l"], "const   a=1\n", "const   a=1\n", 1]
        : [["--fix"], "let a = 1;\nexport { a };\n", "const a = 1;\nexport { a };\n", 0];
    using dir = tempDir("bun-flags-before", { "a.ts": text });
    for (const cmd of flags.flatMap(flag => [
      [bunExe(), flag, command, "a.ts"],
      [bunExe(), "--silent", flag, command, "a.ts"],
    ])) {
      await Bun.write(join(String(dir), "a.ts"), text);
      await using proc = Bun.spawn({ cmd, env: bunEnv, cwd: String(dir), stdout: "pipe", stderr: "pipe" });
      const exitCode = await proc.exited;
      expect({ cmd: cmd.slice(1), text: readFileSync(join(String(dir), "a.ts"), "utf8"), exitCode }).toEqual({
        cmd: cmd.slice(1),
        text: after,
        exitCode: code,
      });
    }
  });

  test("flags of bun and of BUN_OPTIONS before the command aren't passed to it", async () => {
    using dir = tempDir("bun-flags-before", { "a.ts": "export const a = 1;\n" });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--smol", "--no-install", command, "a.ts"],
      env: { ...bunEnv, BUN_OPTIONS: "--prefer-offline" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error");
    expect(exitCode).toBe(0);
  });

  // No other tool has these flags, and the migration guides send people here who still have "lint": "eslint .".
  test.each([["--doctor"], ...(command === "lint" ? [["--explain", "no-var"], ["--explain=no-var"]] : [])])(
    "%s %s isn't passed to a package.json script of that name",
    async (...args) => {
      const scripts = (name: string) => ({
        "package.json": JSON.stringify({ scripts: { [name]: "echo the script" } }),
      });
      const [here, elsewhere] = await Promise.all([
        runIn(scripts(command), command, ...args),
        runIn(scripts("other"), command, ...args),
      ]);
      expect(here.stderr).not.toContain("echo the script");
      expect({ stdout: here.stdout, exitCode: here.exitCode }).toEqual({
        stdout: elsewhere.stdout,
        exitCode: elsewhere.exitCode,
      });
    },
  );

  test("other flags are passed to the script", async () => {
    const files = { "package.json": JSON.stringify({ scripts: { [command]: "echo the script" } }) };
    const { stdout, exitCode } = await runIn(files, command, "--threads=1");
    expect(stdout).toBe("the script --threads=1\n");
    expect(exitCode).toBe(0);
  });

  test("-- --help is passed to the script", async () => {
    const files = { "package.json": JSON.stringify({ scripts: { [command]: "echo the script" } }) };
    const { stdout, exitCode } = await runIn(files, command, "--", "--help");
    expect(stdout).toBe("the script --help\n");
    expect(exitCode).toBe(0);
  });

  test("shell completions list the same flags as --help --all", async () => {
    const { stdout } = await run(command, "--help", "--all");
    const flags = Object.entries(listed(stdout))
      .filter(([, description]) => !/^(No effect|Not supported)/.test(description))
      .map(([flag]) => flag)
      .sort();
    const read = (shell: string) => readFileSync(join(root, "completions", `bun.${shell}`), "utf8");
    const bash = read("bash").match(new RegExp(`^ +${command}\\)\\n.*-W "(.+)" --`, "m"))![1];
    const zsh = read("zsh").match(new RegExp(`^_bun_${command}_completion\\(\\) \\{\\n(.+?)^\\}`, "ms"))![1];
    const fish = read("fish").matchAll(new RegExp(`__fish_seen_subcommand_from ${command}".* -l "([\\w-]+)"`, "g"));
    expect({
      bash: [...bash.matchAll(/--([\w-]+)/g)].map(it => it[1]).sort(),
      zsh: [...zsh.matchAll(/^ +'--([\w-]+)\[/gm)].map(it => it[1]).sort(),
      // bun.fish defines these two once, for every command.
      fish: [...fish, ["", "help"], ["", "version"]].map(it => it[1]).sort(),
    }).toEqual({ bash: flags, zsh: flags, fish: flags });
  });
});

test("bun fmt --all is rejected without --help", async () => {
  const { stdout, stderr, exitCode } = await run("fmt", "--all");
  expect(stderr).toContain("error: --all has no effect without --help");
  expect(stdout).toBe("");
  expect(exitCode).toBe(2);
});

test("bun format is not a command, and says which one is", async () => {
  const { stdout, stderr, exitCode } = await runIn({ "a.js": "a  =  1\n" }, "format");
  expect(stderr).toBe('error: Script not found "format"\nnote: The formatter is bun fmt\n');
  expect(stdout).toBe("");
  expect(exitCode).toBe(1);
});
