import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isLinux, isRoot, isWindows, tempDir } from "harness";
import { join, posix } from "path";

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
    const acceptedFlags = [...params].flatMap(it => it[1].split("/"));
    expect(acceptedFlags.length).toBeGreaterThan(70);
    const mentioned = new Set(stdout.match(/--[\w-]+/g));
    // Listing `--no-semi` covers `--semi` too.
    const missing = acceptedFlags.filter(flag => !mentioned.has(flag) && !mentioned.has(flag.replace("--", "--no-")));
    expect(missing).toEqual([]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("--help and --help --all describe a flag the same way", async () => {
    const [short, all] = await Promise.all([run(command, "--help"), run(command, "--help", "--all")]);
    expect(listed(all.stdout)).toMatchObject(listed(short.stdout));
  });

  test.each([["--help-all"], ["--all", "--help"], ["-h", "--all"]])(
    "%s %s prints the same as --help --all",
    async (...args) => {
      const [one, other] = await Promise.all([run(command, ...args), run(command, "--help", "--all")]);
      expect(one).toEqual(other);
    },
  );

  // ESLint, oxlint, Prettier and the other tools these scripts run have these flags too.
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
  ])("%s %s is passed to the package.json script with that name, and bun exits with its exit code", async (...args) => {
    const files = { "package.json": JSON.stringify({ scripts: { [command]: "echo the script && exit 3 && echo" } }) };
    const { stdout, exitCode } = await runIn(files, command, ...args);
    expect(stdout).toBe("the script\n");
    expect(exitCode).toBe(3);
  });

  test.each(["--help", "-h"])("bun %s <command> prints the help and doesn't write any files", async flag => {
    using dir = tempDir("bun-help-before", { "a.js": "const   a=1\n" });
    await using proc = Bun.spawn({ cmd: [bunExe(), flag, command], env: bunEnv, cwd: String(dir), stderr: "pipe" });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe((await run(command, "--help")).stdout);
    expect(readFileSync(join(String(dir), "a.js"), "utf8")).toBe("const   a=1\n");
    expect(exitCode).toBe(0);
  });

  test("the command's flags also work before the command", async () => {
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

  test("bun's own flags before the command and in BUN_OPTIONS aren't passed to it", async () => {
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
    "%s %s isn't passed to the package.json script with that name",
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
    "%s isn't passed to the package.json script with that name",
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

  const [flags, problem] = {
    lint: [["-f", "unix"], /a\.ts:1:1: .+no-debugger/],
    fmt: [["-l", "--print-width", "80"], /^a\.ts$/],
    check: [["--pretty", "false", "--threads", "1"], /^a\.ts\(2,14\): error TS2322/],
  }[command] as [string[], RegExp];
  const script = { "package.json": JSON.stringify({ scripts: { [command]: "echo the script" } }) };
  const executable = "#!/bin/sh\necho the executable\n";
  const source = "debugger  ;\nexport const a: string = 1;\n";
  /** `from` is the directory to start `bun` in (default: `cwd`). `before` runs first, with the project directory. */
  type More = { from?: string; env?: Record<string, string>; before?: (dir: string) => void };

  /** Runs `bun ...args` in the `cwd` directory of a project containing `files`. Also writes `a.ts` to `cwd`. */
  async function bun(files: Record<string, string>, args: string[], cwd = ".", more: More = {}) {
    using dir = tempDir("bun-no-script", { ...files, [posix.join(cwd, "a.ts")]: source });
    for (const name in files) if (files[name].startsWith("#!")) chmodSync(join(String(dir), name), 0o755);
    more.before?.(String(dir));
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: { ...bunEnv, ...more.env },
      cwd: join(String(dir), more.from ?? cwd),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode, source: readFileSync(join(String(dir), cwd, "a.ts"), "utf8") };
  }

  /** Returns "the command" if `bun` reports the problem in `a.ts`. Otherwise returns the printed output. */
  async function whatRan(...args: Parameters<typeof bun>) {
    const { stdout, stderr, exitCode } = await bun(...args);
    return problem.test(stdout.trim()) && exitCode === 1 ? "the command" : stdout.trim() || stderr.trim();
  }

  describe("--no-script", () => {
    test.each([
      `${command} --no-script ${flags.join(" ")} a.ts`,
      `${command} ${flags.join(" ")} --no-script a.ts`,
      `${command} ${flags.join(" ")} a.ts --no-script`,
      `--no-script ${command} ${flags.join(" ")} a.ts`,
    ])("bun %s runs the command", async args => {
      expect(await whatRan(script, args.split(" "))).toBe("the command");
    });

    const found = [
      ["a script in package.json", script, `the script ${flags.join(" ")} a.ts`, "."],
      ["a file", { [`${command}.ts`]: 'console.log("the file");' }, "the file", "."],
      ["a file without an extension", { [command]: 'console.log("the file");' }, "the file", "."],
      ["a directory's index file", { [`${command}/index.js`]: 'console.log("the index");' }, "the index", "."],
      [
        "a directory with a package.json",
        { [`${command}/package.json`]: '{ "main": "main.js" }', [`${command}/main.js`]: 'console.log("the package");' },
        "the package",
        ".",
      ],
      ...(isWindows
        ? []
        : [
            ["a package's executable", { [`node_modules/.bin/${command}`]: executable }, "the executable", "."],
            [
              "a package's executable in a parent directory",
              { [`node_modules/.bin/${command}`]: executable },
              "the executable",
              "sub",
            ],
            [
              "an executable next to package.json",
              { "package.json": "{}", [command]: executable },
              "the executable",
              "sub",
            ],
          ]),
    ] as [string, Record<string, string>, string, string][];
    // `check` is an older command, and only a package.json script overrides it.
    test.each(command === "check" ? found.slice(0, 1) : found)(
      "%s overrides the command, but not with --no-script",
      async (_, files, printed, cwd) => {
        const [without, withFlag] = await Promise.all([
          whatRan(files, [command, ...flags, "a.ts"], cwd),
          whatRan(files, [command, "--no-script", ...flags, "a.ts"], cwd),
        ]);
        expect({ without, withFlag }).toEqual({ without: printed, withFlag: "the command" });
      },
    );

    // With these flags, `bun <command>` only looks for scripts, even if there's no script with that name.
    test.each(["--if-present", "--workspaces", "--filter=*", "--parallel", "--sequential"])(
      "bun %s <command> only runs the command with --no-script",
      async flag => {
        const [without, withFlag] = await Promise.all([
          whatRan({}, [flag, command, ...flags, "a.ts"]),
          whatRan({}, [flag, command, "--no-script", ...flags, "a.ts"]),
        ]);
        expect(without).not.toBe("the command");
        expect(withFlag).toBe("the command");
      },
    );

    test("has no effect if nothing in the project has the command's name", async () => {
      expect(await whatRan({}, [command, "--no-script", ...flags, "a.ts"])).toBe("the command");
    });

    test("is a file name after --", async () => {
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

    test("bun run <command> runs the script and passes it the flag", async () => {
      expect(await whatRan(script, ["run", command, "--no-script"])).toBe("the script --no-script");
    });

    // A `bun` flag before the command can have its value in the next argument.
    describe.each([
      ["a script", script],
      ["a file", { [`${command}.ts`]: 'console.log("the file");' }],
      ...(isWindows ? [] : [["a package's executable", { [`node_modules/.bin/${command}`]: executable }]]),
    ] as [string, Record<string, string>][])("when the project has %s", (_, own) => {
      const rest = [...flags, "a.ts"];

      test.each([
        ["--env-file", ".env"],
        ["--preload", "./pre.js"],
        // `bun check` doesn't accept `-r` or `-r=./pre.js`.
        ...(command === "check" ? [] : [["-r", "./pre.js"]]),
        ["--shell", "bun"],
        ["--elide-lines", "5"],
      ])("bun %s %s <command> behaves like bun <command>", async (...front) => {
        const files = { ...own, ".env": "A=1\n", "pre.js": "" };
        const [plain, without, after, before, inOptions] = await Promise.all([
          whatRan(files, [command, ...rest]),
          whatRan(files, [...front, command, ...rest]),
          whatRan(files, [...front, command, "--no-script", ...rest]),
          whatRan(files, ["--no-script", ...front, command, ...rest]),
          whatRan(files, [command, "--no-script", ...rest], ".", { env: { BUN_OPTIONS: front.join(" ") } }),
        ]);
        expect({ without, after, before, inOptions }).toEqual({
          without: plain,
          after: "the command",
          before: "the command",
          inOptions: "the command",
        });
      });

      test("bun --cwd <directory> <command> behaves like bun <command> in that directory", async () => {
        const files = Object.fromEntries(Object.entries(own).map(([name, text]) => [`project/${name}`, text]));
        const outside = (args: string[], env = {}) => whatRan(files, args, "project", { from: ".", env });
        const [plain, without, ...withFlag] = await Promise.all([
          whatRan(own, [command, ...rest]),
          outside(["--cwd", "project", command, ...rest]),
          outside(["--cwd", "project", command, "--no-script", ...rest]),
          outside(["--no-script", "--cwd", "project", command, ...rest]),
          outside([command, "--no-script", ...rest], { BUN_OPTIONS: "--cwd project" }),
          outside([command, ...rest], { BUN_OPTIONS: "--no-script --cwd project" }),
          outside(["--cwd", "project", command, ...rest], { BUN_OPTIONS: "--no-script" }),
        ]);
        expect(without).toBe(plain);
        expect(withFlag).toEqual(Array(5).fill("the command"));
      });
    });

    test.each(command === "check" ? ["--filter"] : ["--filter", "-F"])(
      "bun %s <pattern> <command> behaves like bun --filter=<pattern> <command>",
      async flag => {
        const rest = [...flags, "a.ts"];
        const [blank, equals, withFlag] = await Promise.all([
          whatRan(script, [flag, "*", command, ...rest]),
          whatRan(script, ["--filter=*", command, ...rest]),
          whatRan(script, [flag, "*", command, "--no-script", ...rest]),
        ]);
        expect({ blank, withFlag }).toEqual({ blank: equals, withFlag: "the command" });
      },
    );

    test.skipIf(command !== "check").each([
      ["-r", "./pre.js"],
      ["-F", "*"],
    ])("bun %s %s check --no-script fails and doesn't run the script", async (...front) => {
      const result = await bun({ ...script, "pre.js": "" }, [...front, command, "--no-script"]);
      expect(result.stderr).toStartWith(`error: Invalid Argument '${front[0]}'\n`);
      expect(result).toMatchObject({ stdout: "", exitCode: 1 });
    });
  });

  describe("a directory with the same name as the command", () => {
    const files = {
      [`${command}/package.json`]: JSON.stringify({ scripts: { dev: "echo the dev script" } }),
      [`${command}/main.ts`]: 'console.log("the file");',
    };

    test.each([
      ["dev", "the dev script\n"],
      ["main.ts", "the file\n"],
    ])("bun --cwd <directory> %s doesn't run the command", async (word, printed) => {
      const result = await bun(files, ["--cwd", command, word], command, { from: "." });
      expect(result).toMatchObject({ stdout: printed, source, exitCode: 0 });
    });

    test("bun --cwd <directory> <command> runs the command", async () => {
      const args = ["--cwd", command, command, ...flags, "a.ts"];
      expect(await whatRan(files, args, command, { from: "." })).toBe("the command");
    });
  });

  test.each([
    ["-e", 'console.log("evaluated")', "evaluated\n"],
    ["-be", 'console.log("evaluated")', "evaluated\n"],
    ["-p", '"printed"', "printed\n"],
    ["-bp", '"printed"', "printed\n"],
  ])("bun %s <code> <command> evaluates the code", async (flag, code, printed) => {
    expect(await bun({}, [flag, code, command])).toMatchObject({ stdout: printed, source, exitCode: 0 });
    // `bun -ptsconfig.json check` is `bun check --project tsconfig.json`.
    if (command === "check" && flag.endsWith("p")) return;
    expect(await bun({}, [flag + code, command])).toMatchObject({ stdout: printed, source, exitCode: 0 });
  });

  // Each contains an `e`, a `p` or an `F`, which mean `--eval`, `--print` and `--filter` in grouped short `bun` flags.
  test.skipIf(command !== "lint").each(["-f=agent", "-fagent", "-Deqeqeq", "-Dprefer-const"])(
    "bun %s lint: a lint flag isn't parsed as a group of short bun flags",
    async flag => {
      const { stdout, exitCode } = await bun({}, [flag, command, "a.ts"]);
      expect(stdout).toContain("no-debugger");
      expect(exitCode).toBe(1);
    },
  );

  test.skipIf(command !== "check").each(["-ptsconfig.json", "-p=tsconfig.json", "-bptsconfig.json"])(
    "bun %s check reads the flag as --project",
    async flag => {
      expect(await whatRan({ "tsconfig.json": "{}" }, [flag, command, ...flags])).toBe("the command");
    },
  );

  test.skipIf(command === "check")("bun -bc=<path> <command>: letters in the path aren't parsed as flags", async () => {
    expect(await whatRan({ "all.toml": "" }, ["-bc=all.toml", command, ...flags, "a.ts"])).toBe("the command");
  });

  test.each(["-F", "-bF"])("bun %s <pattern> <command> runs the packages' scripts", async flag => {
    const files = {
      "package.json": JSON.stringify({ workspaces: ["one"] }),
      "one/package.json": JSON.stringify({ name: "one", scripts: { [command]: "echo the script" } }),
    };
    for (const args of [[flag, "*"], [`${flag}*`]]) {
      const result = await bun(files, [...args, command]);
      expect(result.stdout).toContain("the script");
      expect(result).toMatchObject({ source, exitCode: 0 });
    }
  });

  describe("--cwd is resolved the same way as for `bun run`", () => {
    test.each([[["--cwd="]], [["--cwd", ""]]])("an empty value means the working directory: %j", async cwd => {
      expect(await whatRan(script, [...cwd, command])).toBe("the script");
      expect(await whatRan({}, [...cwd, command, ...flags, "a.ts"])).toBe("the command");
    });

    test.each(["missing/..", "a.ts/..", "missing/../."])(
      "`..` cancels a preceding name that isn't a directory: %s",
      async cwd => {
        expect(await whatRan(script, [`--cwd=${cwd}`, command])).toBe("the script");
        expect(await whatRan(script, ["--cwd", cwd, command])).toBe("the script");
      },
    );

    test.skipIf(isWindows)("`..` after a symlink resolves to the directory that contains the symlink", async () => {
      const files = { "project/package.json": script["package.json"], "else/where/deep/b.ts": source };
      const before = (dir: string) => symlinkSync("../else/where/deep", join(dir, "project/link"));
      expect(await whatRan(files, ["--cwd=link/..", command], "project", { before })).toBe("the script");
      expect(
        await whatRan(files, ["--cwd=link/..", command, "--no-script", ...flags, "a.ts"], "project", { before }),
      ).toBe("the command");
    });
  });

  describe.skipIf(command === "check")("a bun flag whose value is the command's name", () => {
    test.skipIf(command !== "fmt")("a command flag after it still applies", async () => {
      const result = await bun({}, ["--title", command, "--check", command, "a.ts"]);
      expect(result).toMatchObject({ source, exitCode: 1 });
    });

    test("--cwd after it still applies", async () => {
      const args = ["--title", command, "--cwd", "sub", command, ...flags, "a.ts"];
      expect(await whatRan({}, args, "sub", { from: "." })).toBe("the command");
    });
  });

  // Without a config file, `bun lint` looks for `eslintConfig` in the package.json.
  const config = { ".oxlintrc.json": '{ "rules": { "no-debugger": "error" } }' };

  describe("a package.json that can't be parsed", () => {
    const scripts = `"scripts": { "${command}": "echo the script" }`;
    const note = `note: package.json may have a "${command}" script, so nothing was run
  Fix the file, or pass --no-script to skip the script
`;
    const inConflict = (rest: string) =>
      `{\n<<<<<<< HEAD\n  "version": "1",\n=======\n  "version": "2",\n>>>>>>> other\n  ${rest}\n}\n`;
    const broken = { "package.json": inConflict(scripts) };

    describe.each([
      ["has merge conflict markers", inConflict(scripts), /^error: .+\n {4}at .+package\.json:2:1$/m],
      [
        "is truncated",
        `{\n  "name": "a",\n  "scripts": { "${command}": "echo the`,
        /^error: .+\n {4}at .+package\.json:3:\d+$/m,
      ],
    ] as [string, string, RegExp][])("one that %s", (_, text, error) => {
      const scriptLocations: [string, Record<string, string>, string][] = [
        ["in the working directory", { "package.json": text }, "."],
        [
          "in a workspace whose root has the script",
          { "package.json": `{ "workspaces": ["packages/*"], ${scripts} }`, "packages/a/package.json": text },
          "packages/a",
        ],
      ];

      // `bun lint --fix` and `bun fmt` can both write `a.ts`.
      test.skipIf(command === "check").each(scriptLocations)(
        "%s: fails without running anything",
        async (_, files, cwd) => {
          // Candidates that are tried after package.json.
          const others = {
            [posix.join(cwd, `${command}.ts`)]: 'console.log("the file");',
            [posix.join(cwd, "node_modules/.bin", command)]: executable,
          };
          const result = await bun({ ...files, ...others }, command === "lint" ? ["lint", "--fix"] : ["fmt"], cwd);
          expect(result.stderr).toMatch(error);
          expect(result.stderr).toContain(join(cwd, "package.json"));
          expect(result.stderr).toEndWith(note);
          expect(result).toMatchObject({ stdout: "", source, exitCode: 2 });
        },
      );

      test.skipIf(command !== "check").each(scriptLocations)("%s: the type checker runs", async (_, files, cwd) => {
        expect(await whatRan(files, [command, ...flags, "a.ts"], cwd)).toBe("the command");
      });

      test("--no-script runs the command", async () => {
        const files = { "package.json": text, ...config };
        expect(await whatRan(files, [command, "--no-script", ...flags, "a.ts"])).toBe("the command");
      });
    });

    test.each([
      [command, "--help"],
      [command, "-h"],
      ["--help", command],
      ["-h", command],
    ])("bun %s %s prints the help", async (...args) => {
      const [here, elsewhere] = await Promise.all([runIn(broken, ...args), run(command, "--help")]);
      expect(here).toEqual(elsewhere);
    });

    test.skipIf(command === "check").each(["--version", "-v", "--revision"])(
      "bun %s <command> prints the version",
      async flag => {
        const [here, elsewhere] = await Promise.all([runIn(broken, flag, command), run(flag)]);
        expect(here).toEqual(elsewhere);
      },
    );

    test.skipIf(command === "check")(
      "bun <command> --version would be passed to the script, so nothing is run",
      async () => {
        const { stdout, stderr, exitCode } = await runIn(broken, command, "--version");
        expect(stderr).toEndWith(note);
        expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 2 });
      },
    );

    test("runs the command if the file doesn't contain the script's name", async () => {
      const files = { "package.json": inConflict('"scripts": { "other": "echo no" }'), ...config };
      expect(await whatRan(files, [command, ...flags, "a.ts"])).toBe("the command");
    });
  });

  describe("finding the package.json with the script", () => {
    test.each([
      ["with other scripts", `{ "name": "${command}", "scripts": { "other": "echo no" } }`],
      ["that is empty", ""],
      ["with only whitespace", " \n"],
      ["that is an array", `["${command}"]\n`],
      ["that is null", "null\n"],
    ])("runs the command with a package.json %s", async (_, text) => {
      expect(await whatRan({ "package.json": text, ...config }, [command, ...flags, "a.ts"])).toBe("the command");
    });

    const code = command.charCodeAt(0).toString(16);
    // `bun run` reads all of these.
    test.each([
      ["in single quotes", `{ 'scripts': { '${command}': 'echo the script' } }`],
      ["with \\u", `{ "scripts": { "\\u00${code}${command.slice(1)}": "echo the script" } }`],
      ["with \\x", `{ "scripts": { "\\x${code}${command.slice(1)}": "echo the script" } }`],
    ])("finds a script name written %s", async (_, text) => {
      expect(await whatRan({ "package.json": text }, [command])).toBe("the script");
    });

    test("reads a UTF-16 package.json like `bun run` does", async () => {
      const text = `\ufeff{ "scripts": { "${command}": "echo the script" } }`;
      const before = (dir: string) => writeFileSync(join(dir, "package.json"), Buffer.from(text, "utf16le"));
      expect(await whatRan({}, [command], ".", { before })).toBe("the script");
    });

    describe.skipIf(isWindows)("a package.json that isn't a readable file", () => {
      const root = { "package.json": `{ "scripts": { "${command}": "echo the script" } }` };
      const link = (to: string) => (dir: string) => symlinkSync(to, join(dir, "sub/package.json"));
      const pipe = (dir: string) => expect(Bun.spawnSync(["mkfifo", join(dir, "sub/package.json")]).exitCode).toBe(0);

      test.each([
        ["a dangling link", link("nowhere")],
        ["a link to itself", link("package.json")],
        ["a directory", (dir: string) => mkdirSync(join(dir, "sub/package.json"))],
      ] as [string, More["before"]][])("%s: uses the parent directory's package.json", async (_, before) => {
        expect(await whatRan(root, [command], "sub", { before })).toBe("the script");
      });

      test.skipIf(isRoot)("a file without read permission: uses the parent directory's package.json", async () => {
        const before = (dir: string) => chmodSync(join(dir, "sub/package.json"), 0);
        expect(await whatRan({ ...root, "sub/package.json": "{}" }, [command], "sub", { before })).toBe("the script");
      });

      test.each([
        ["a link to a device", link("/dev/null")],
        ["a named pipe", pipe],
      ] as [string, More["before"]][])("%s: runs the command, not the parent's script", async (_, before) => {
        expect(await whatRan(root, [command, ...flags, "a.ts"], "sub", { before })).toBe("the command");
      });
    });
  });

  // `check` is an older command, and only a package.json script overrides it.
  describe.skipIf(command === "check")("the project's own <command> can call the built-in bun <command>", () => {
    const again = [command, ...flags, "a.ts"];
    const file = `
      if (process.env.STARTED) throw new Error("started again");
      const env = { ...process.env, STARTED: "1" };
      const child = Bun.spawnSync({ cmd: [process.execPath, ...${JSON.stringify(again)}], env, stdout: "inherit" });
      process.exit(child.exitCode);
    `;
    const packageExecutable = `#!/bin/sh
if [ -n "$STARTED" ]; then echo started again; exit 3; fi
STARTED=1 exec "${bunExe()}" ${again.join(" ")}
`;

    describe.each([
      ["a file", { [`${command}.ts`]: file }],
      ["a directory's index", { [`${command}/index.ts`]: file }],
      ...(isWindows ? [] : [["a package's executable", { [`node_modules/.bin/${command}`]: packageExecutable }]]),
    ] as [string, Record<string, string>][])("%s", (_, files) => {
      test.each([
        ["bun <command>", [command], {}],
        ["bun <command>, beside a package.json", [command], { "package.json": "{}" }],
        ["bun run <command>", ["run", command], {}],
      ] as [string, string[], Record<string, string>][])("%s", async (_, args, more) => {
        expect(await whatRan({ ...files, ...more }, args)).toBe("the command");
      });
    });
  });

  test.skipIf(isWindows)("a backslash in a directory name isn't a separator", async () => {
    const { stdout, exitCode } = await bun(
      { "a\\b/package.json": script["package.json"] },
      [command, "--help"],
      "a\\b",
    );
    expect(stdout).toContain(`note: package.json has a "${command}" script, so bun ${command} runs that script\n`);
    expect(exitCode).toBe(0);
  });

  // Skipped for `bun check`. Like TypeScript, it treats a backslash as a separator everywhere, so it can't find files
  // in a directory like this.
  describe.skipIf(isWindows || command === "check")("a backslash in a directory name with --cwd", () => {
    // The directory that `a\b` would resolve to if the backslash were a separator.
    const other = { "a/b/other.ts": source, "a/b/sub/other.ts": source };

    test.each([
      [".", "a\\b", "a\\b"],
      ["sub", "a\\b", "a\\b/sub"],
      ["a\\b", ".", "a\\b"],
    ])("--cwd=%s in %s runs the command in the right directory", async (cwd, from, directory) => {
      for (const args of [
        [`--cwd=${cwd}`, command],
        [command, "--cwd", cwd],
      ]) {
        expect(await whatRan(other, [...args, ...flags, "a.ts"], directory, { from })).toBe("the command");
      }
    });
  });

  // Like in a script written on Windows.
  test.each(["apps\\web", ".\\apps\\web\\", "apps\\other\\..\\web"])("--cwd=%s resolves to apps/web", async cwd => {
    const files = { "apps/web/package.json": script["package.json"] };
    expect(await whatRan(files, [`--cwd=${cwd}`, command], "apps/web", { from: "." })).toBe("the script");
    expect(await whatRan(files, ["--cwd", cwd, command], "apps/web", { from: "." })).toBe("the script");
    const args = [`--cwd=${cwd}`, command, "--no-script", ...flags, "a.ts"];
    expect(await whatRan(files, args, "apps/web", { from: "." })).toBe("the command");
  });

  test.skipIf(isWindows || command === "check")("in `a\\b`, --cwd=missing doesn't resolve to a/b/missing", async () => {
    const result = await bun({ "a/b/missing/a.ts": source }, ["--cwd=missing", command, ...flags, "a.ts"], "a\\b");
    expect(result.stderr).toContain('Could not change directory to "missing"');
    expect(result.exitCode).toBe(1);
  });

  test.skipIf(isWindows)("an absolute --cwd works when the working directory was deleted", async () => {
    using dir = tempDir("bun-no-script", { "project/a.ts": source, "deleted/a.ts": "" });
    const args = [`--cwd=${join(String(dir), "project")}`, command, ...flags, "a.ts"];
    await using proc = Bun.spawn({
      cmd: ["sh", "-c", 'rm -r "$PWD" && exec "$0" "$@"', bunExe(), ...args],
      env: bunEnv,
      cwd: join(String(dir), "deleted"),
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toMatch(problem);
    expect(exitCode).toBe(1);
  });

  test.skipIf(isWindows)("an absolute --cwd can contain `//`, `.` and `..`", async () => {
    using dir = tempDir("bun-no-script", { "project/a.ts": source });
    const cwd = `/..//${String(dir).slice(1)}/./missing/../project//`;
    await using proc = Bun.spawn({
      cmd: [bunExe(), `--cwd=${cwd}`, command, ...flags, "a.ts"],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toMatch(problem);
    expect(exitCode).toBe(1);
  });

  // The path of a package.json in this directory exceeds PATH_MAX.
  test.skipIf(!isLinux)("finds the script from a working directory whose path is almost PATH_MAX long", async () => {
    using dir = tempDir("bun-long-path", script);
    let cwd = String(dir);
    while (cwd.length < 4085) cwd = join(cwd, Buffer.alloc(Math.min(100, 4089 - cwd.length), "d").toString());
    mkdirSync(cwd, { recursive: true });
    await using proc = Bun.spawn({ cmd: [bunExe(), command], env: bunEnv, cwd, stderr: "pipe" });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe("the script\n");
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
      fish: [...fish, ["", "help"], ...(command === "check" ? [] : [["", "version"]])].map(it => it[1]).sort(),
    }).toEqual({ bash: flags, zsh: flags, fish: flags });
  });
});

test.concurrent(
  "--no-script runs bun lint and bun fmt in a project whose lint and fmt scripts are other tools",
  async () => {
    const files = {
      "package.json":
        '{ "scripts": { "lint": "echo this is the lint script", "fmt": "echo this is the fmt script" } }\n',
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
  },
);

test.concurrent("bun check --no-script -b type-checks a project whose check script is another tool", async () => {
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
    // Without `-b`, a note about the references comes first.
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

test("bun format isn't a command, and the error points to bun fmt", async () => {
  const { stdout, stderr, exitCode } = await runIn({ "a.js": "a  =  1\n" }, "format");
  expect(stderr).toBe('error: Script not found "format"\nnote: The formatter is bun fmt\n');
  expect(stdout).toBe("");
  expect(exitCode).toBe(1);
});
