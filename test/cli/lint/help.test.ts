import { describe, expect, test } from "bun:test";
import { chmodSync, readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
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
      "no-script",
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
      "no-script",
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
});

describe.concurrent.each(["lint", "fmt", "check"])("bun %s", command => {
  test.each(["--help", "-h", ...(command === "check" ? [] : ["--help-all"])])(
    "%s isn't passed to a package.json script of that name",
    async flag => {
      const files = { "package.json": JSON.stringify({ scripts: { [command]: "echo the script" } }) };
      const [here, elsewhere] = await Promise.all([runIn(files, command, flag), run(command, flag)]);
      expect(here.stdout).toBe(
        `${elsewhere.stdout}
note: package.json has a "${command}" script, so bun ${command} runs that script
  Change the script to "bun ${command}" to use the built-in command, or pass --no-script
`,
      );
      expect(here.exitCode).toBe(0);
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

  describe("--no-script", () => {
    const [flags, problem] = {
      lint: [["-f", "unix"], /a\.ts:1:1: .+no-debugger/],
      fmt: [["-l", "--print-width", "80"], /^a\.ts$/],
      check: [["--pretty", "false", "--threads", "1"], /^a\.ts\(2,14\): error TS2322/],
    }[command] as [string[], RegExp];
    const script = { "package.json": JSON.stringify({ scripts: { [command]: "echo the script" } }) };
    const executable = "#!/bin/sh\necho the executable\n";

    /**
     * What `bun ...args` runs in the directory `cwd` of a project with `files`: "the command" if it reports the problem in
     * `a.ts`, and otherwise what is printed.
     */
    async function ran(files: Record<string, string>, args: string[], cwd = ".") {
      using dir = tempDir("bun-no-script", {
        ...files,
        [join(cwd, "a.ts")]: "debugger  ;\nexport const a: string = 1;\n",
      });
      for (const name in files) if (files[name] === executable) chmodSync(join(String(dir), name), 0o755);
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...args],
        env: bunEnv,
        cwd: join(String(dir), cwd),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return problem.test(stdout.trim()) && exitCode === 1 ? "the command" : stdout.trim() || stderr.trim();
    }

    test.each([
      `${command} --no-script ${flags.join(" ")} a.ts`,
      `${command} ${flags.join(" ")} --no-script a.ts`,
      `${command} ${flags.join(" ")} a.ts --no-script`,
      `--no-script ${command} ${flags.join(" ")} a.ts`,
    ])("bun %s", async args => {
      expect(await ran(script, args.split(" "))).toBe("the command");
    });

    const found = [
      ["a script in package.json", script, `the script ${flags.join(" ")} a.ts`, "."],
      ["a file", { [`${command}.ts`]: 'console.log("the file");' }, "the file", "."],
      ["a file without an extension", { [command]: 'console.log("the file");' }, "the file", "."],
      ["the index of a directory", { [`${command}/index.js`]: 'console.log("the index");' }, "the index", "."],
      [
        "a directory with a package.json",
        { [`${command}/package.json`]: '{ "main": "main.js" }', [`${command}/main.js`]: 'console.log("the package");' },
        "the package",
        ".",
      ],
      ...(isWindows
        ? []
        : [
            ["an executable of a package", { [`node_modules/.bin/${command}`]: executable }, "the executable", "."],
            [
              "an executable of a package further up",
              { [`node_modules/.bin/${command}`]: executable },
              "the executable",
              "sub",
            ],
            [
              "an executable beside package.json",
              { "package.json": "{}", [command]: executable },
              "the executable",
              "sub",
            ],
          ]),
    ] as [string, Record<string, string>, string, string][];
    // `check` has been a command for longer, and only a script wins over it.
    test.each(command === "check" ? found.slice(0, 1) : found)(
      "%s wins over the command, and not with the flag",
      async (_, files, printed, cwd) => {
        const [without, withFlag] = await Promise.all([
          ran(files, [command, ...flags, "a.ts"], cwd),
          ran(files, [command, "--no-script", ...flags, "a.ts"], cwd),
        ]);
        expect({ without, withFlag }).toEqual({ without: printed, withFlag: "the command" });
      },
    );

    // These make `bun <command>` a matter of scripts, even where there is no such script.
    test.each(["--if-present", "--workspaces", "--filter=*", "--parallel", "--sequential"])(
      "bun %s <command> isn't the command, and is with the flag",
      async flag => {
        const [without, withFlag] = await Promise.all([
          ran({}, [flag, command, ...flags, "a.ts"]),
          ran({}, [flag, command, "--no-script", ...flags, "a.ts"]),
        ]);
        expect(without).not.toBe("the command");
        expect(withFlag).toBe("the command");
      },
    );

    test("it changes nothing where the project has nothing of that name", async () => {
      expect(await ran({}, [command, "--no-script", ...flags, "a.ts"])).toBe("the command");
    });

    test("after -- it is a file name", async () => {
      const [here, elsewhere] = await Promise.all([
        runIn(script, command, "--", "--no-script"),
        run(command, "--", "--no-script"),
      ]);
      expect(here.stdout).toBe("the script --no-script\n");
      if (command === "check") {
        expect(elsewhere.stdout).toMatch(/^error TS6053: File '.*--no-script' not found/);
        expect(elsewhere.exitCode).toBe(1);
      } else {
        expect(elsewhere.stderr).toMatch(/^error: No files matching the pattern .*"--no-script"/);
        expect(elsewhere.exitCode).toBe(2);
      }
    });

    test("bun run <command> is the script, which is passed the flag", async () => {
      expect(await ran(script, ["run", command, "--no-script"])).toBe("the script --no-script");
    });
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
      fish: [...fish, ["", "help"], ...(command === "check" ? [] : [["", "version"]])].map(it => it[1]).sort(),
    }).toEqual({ bash: flags, zsh: flags, fish: flags });
  });
});

test.concurrent("--no-script in a project whose lint and fmt scripts are other tools", async () => {
  const files = {
    "package.json": '{ "scripts": { "lint": "echo this is the lint script", "fmt": "echo this is the fmt script" } }\n',
    ".oxlintrc.json": '{ "rules": { "eqeqeq": "error" } }\n',
    "a.js": "export const a = (b) => b == 1;\n",
  };
  const results = await Promise.all([
    runIn(files, "lint", "--no-script", "a.js"),
    runIn(files, "lint", "-c", ".oxlintrc.json", "--no-script", "a.js"),
    runIn(files, "fmt", "--no-script", "--check", "a.js"),
  ]);
  const printed = results.map(it => it.stdout + it.stderr);
  for (const text of printed) expect(text).not.toContain("script");
  expect(printed[0]).toContain("Expected === and instead saw ==");
  expect(printed[1]).toContain("Expected === and instead saw ==");
  expect(printed[2]).toBe("1 file is formatted.\n");
  expect(results.map(it => it.exitCode)).toEqual([1, 1, 0]);
});

test.concurrent("bun check --no-script -b in a project whose check script is another tool", async () => {
  const files = {
    "package.json": '{ "scripts": { "check": "echo this is the check script" } }\n',
    "tsconfig.json": '{ "files": [], "references": [{ "path": "./sub" }] }\n',
    "sub/tsconfig.json": '{ "compilerOptions": { "composite": true, "skipLibCheck": true } }\n',
    "sub/a.ts": "export const a: string = 1;\n",
  };
  const [script, ...results] = await Promise.all([
    runIn(files, "check", "-b"),
    runIn(files, "check", "--no-script", "-b"),
    runIn(files, "check", "-b", "--no-script"),
    runIn(files, "check", "--no-script", "-bp", "."),
    runIn(files, "--no-script", "check", "-b"),
  ]);
  expect(script.stdout).toBe("this is the check script -b\n");
  for (const { stdout, stderr, exitCode } of results) {
    expect(stdout).toBe("sub/a.ts(1,14): error TS2322: Type 'number' is not assignable to type 'string'.\n");
    // Without `-b` there is a note first, about the references.
    expect(stderr).toStartWith("Found 1 error in 1 file, checked 1 file across 1 project");
    expect(exitCode).toBe(1);
  }
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
