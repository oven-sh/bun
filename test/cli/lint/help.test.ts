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

/** The flags that a help lists, by their long names, and what it says about each. */
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
    command: "format",
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
      `Full documentation is available at https://bun.com/docs/runtime/${command}`,
      `See every flag with bun ${command} --help --all`,
    ]);
    expect(lines.length).toBeLessThanOrEqual(25);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("--help --all has every flag that the command takes", async () => {
    const { stdout, stderr, exitCode } = await run(command, "--help", "--all");
    expect(stdout.match(/^\S.*:$/gm)).toEqual([...headings.map(heading => `${heading}:`), "Examples:"]);
    const params = readFileSync(join(root, source), "utf8").matchAll(/clap::param!\(\s*"(?:-\w, )?(--[^\s"]+)/g);
    const taken = [...params].flatMap(it => it[1].split("/"));
    expect(taken.length).toBeGreaterThan(70);
    const mentioned = new Set(stdout.match(/--[\w-]+/g));
    // `--no-semi` stands for `--semi` too.
    const missing = taken.filter(flag => !mentioned.has(flag) && !mentioned.has(flag.replace("--", "--no-")));
    expect(missing).toEqual([]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("--help says about a flag what --help --all says", async () => {
    const [short, all] = await Promise.all([run(command, "--help"), run(command, "--help", "--all")]);
    expect(listed(all.stdout)).toMatchObject(listed(short.stdout));
  });

  test.each([["--help-all"], ["--all", "--help"], ["-h", "--all"]])("%s %s is --help --all", async (...args) => {
    const [one, other] = await Promise.all([run(command, ...args), run(command, "--help", "--all")]);
    expect(one).toEqual(other);
  });

  test.each(["--help", "-h", "--help-all"])("%s is not for a script of that name in package.json", async flag => {
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

  // They ask Bun about itself, and nothing is linted or formatted.
  test.each([
    ["--doctor"],
    ["--init"],
    ["--rules"],
    ["--explain", "no-var"],
    ["--explain=no-var"],
    ["--print-config", "a.js"],
    ["--print-config=a.js"],
    ["--version"],
    ["-v"],
    ["-V"],
  ])("%s %s is not for a script of that name in package.json", async (...args) => {
    const scripts = (name: string) => ({ "package.json": JSON.stringify({ scripts: { [name]: "echo the script" } }) });
    const [here, elsewhere] = await Promise.all([
      runIn(scripts(command), command, ...args),
      runIn(scripts("other"), command, ...args),
    ]);
    expect(here.stderr).not.toContain("echo the script");
    expect({ stdout: here.stdout, exitCode: here.exitCode }).toEqual({
      stdout: elsewhere.stdout,
      exitCode: elsewhere.exitCode,
    });
  });

  test("another flag is for the script", async () => {
    const files = { "package.json": JSON.stringify({ scripts: { [command]: "echo the script" } }) };
    const { stdout, exitCode } = await runIn(files, command, "--threads=1");
    expect(stdout).toBe("the script --threads=1\n");
    expect(exitCode).toBe(0);
  });

  test("-- --help is for the script", async () => {
    const files = { "package.json": JSON.stringify({ scripts: { [command]: "echo the script" } }) };
    const { stdout, exitCode } = await runIn(files, command, "--", "--help");
    expect(stdout).toBe("the script --help\n");
    expect(exitCode).toBe(0);
  });

  test("the shell completions have the flags of --help --all", async () => {
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
      // It has these two for every command.
      fish: [...fish, ["", "help"], ["", "version"]].map(it => it[1]).sort(),
    }).toEqual({ bash: flags, zsh: flags, fish: flags });
  });
});

test("bun format --all is refused without --help", async () => {
  const { stdout, stderr, exitCode } = await run("format", "--all");
  expect(stderr).toContain("error: --all has no effect without --help");
  expect(stdout).toBe("");
  expect(exitCode).toBe(2);
});
