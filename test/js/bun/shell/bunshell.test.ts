/**
 * Portions of these tests are derived from the [deno_task_shell](https://github.com/denoland/deno_task_shell/) tests, which are developed and maintained by the Deno authors.
 * Copyright 2018-2023 the Deno authors.
 *
 * This code is licensed under the MIT License: https://opensource.org/licenses/MIT
 */
import { $ } from "bun";
import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import { chmodSync, mkdirSync, symlinkSync } from "fs";
import { mkdir, rm, stat } from "fs/promises";
import {
  bunExe,
  isPosix,
  isRoot,
  isWindows,
  rss,
  runWithErrorPromise,
  tempDir,
  tempDirWithFiles,
  tmpdirSync,
} from "harness";
import { join, sep } from "path";
import { createTestBuilder, sortedShellOutput } from "./util";
const TestBuilder = createTestBuilder(import.meta.path);

afterAll(() => console.error("After all RSS", rss() / 1024 / 1024));
beforeAll(() => console.error("Before all RSS", rss() / 1024 / 1024));

export const bunEnv: NodeJS.ProcessEnv = {
  ...process.env,
  GITHUB_ACTIONS: "false",
  BUN_DEBUG_QUIET_LOGS: "1",
  NO_COLOR: "1",
  FORCE_COLOR: undefined,
  TZ: "Etc/UTC",
  CI: "1",
  BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
  BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
  BUN_GARBAGE_COLLECTOR_LEVEL: process.env.BUN_GARBAGE_COLLECTOR_LEVEL || "0",
  // windows doesn't set this, but we do to match posix compatibility
  PWD: (process.env.PWD || process.cwd()).replaceAll("\\", "/"),
};

// The parameter expansion tests read these names as not set.
const notSet = ["A", "B", "BAR", "C", "E", "EMPTY", "FOO", "NONE", "S", "U", "V", "VALUE", "W"];
for (const name of Object.keys(bunEnv)) {
  if (notSet.includes(name) || name.startsWith("SHELL_TEST_")) delete bunEnv[name];
}

$.env(bunEnv);
$.cwd(process.cwd().replaceAll("\\", "/"));
$.nothrow();

let temp_dir: string;
const temp_files = ["foo.txt", "lmao.ts"];
beforeAll(async () => {
  $.nothrow();
  temp_dir = tmpdirSync();
  await mkdir(temp_dir, { recursive: true });

  for (const file of temp_files) {
    const writer = Bun.file(join(temp_dir, file)).writer();
    writer.write("foo");
    writer.end();
  }
});

afterAll(async () => {
  await rm(temp_dir, { force: true, recursive: true });
});

const BUN = bunExe();
// With `bun -e`: prints the arguments as JSON, so a test sees where each one ends.
const printArgv = "console.log(JSON.stringify(process.argv.slice(1)))";
// The arguments that `word` gives in a folder with `files`. When the word fails: the error.
const argvIn = async (files: string[], word: string) => {
  using dir = tempDir("shell-argv", Object.fromEntries(files.map(file => [file, ""])));
  const { stdout, stderr, exitCode } = await $`${BUN} -e ${printArgv} ${{ raw: word }}`.cwd(String(dir)).quiet();
  return exitCode === 0 ? JSON.parse(stdout.toString()) : stderr.toString();
};

describe("bunshell", () => {
  describe("exit codes", async () => {
    const failing_cmds = [
      process.platform === "win32" ? "cat ldkfjsldf" : null,
      "touch -alskdjfakjfhasjfh",
      "mkdir",
      "export",
      "cd lskfjlsdkjf",
      process.platform !== "win32" ? "echo hi > /dev/full" : null,
      "pwd sldfkj sfks jdflks flksd f",
      "which",
      "rm lskdjfskldjfksdjflkjsldfj",
      "mv lskdjflskdjf lskdjflskjdlf",
      "ls lksdjflksdjf",
      "exit sldkfj sdjf ls f",
      // "true",
      // "false",
      // "yes",
      // "seq",
      "dirname",
      "basename",
      "cp ksdjflksjdfks lkjsdflksjdfl",
    ];

    failing_cmds.forEach(cmdstr =>
      !!cmdstr
        ? TestBuilder.command`${{ raw: cmdstr }}`
            .exitCode(c => c !== 0)
            .stdout(() => {})
            .stderr(() => {})
            .runAsTest(cmdstr)
        : "",
    );
  });

  describe("concurrency", () => {
    test("writing to stdout", async () => {
      await Promise.all([
        TestBuilder.command`echo 1`.stdout("1\n").run(),
        TestBuilder.command`echo 2`.stdout("2\n").run(),
        TestBuilder.command`echo 3`.stdout("3\n").run(),
      ]);
    });
  });
  describe("js_obj_test", async () => {
    function runTest(name: string, builder: InstanceType<typeof TestBuilder>) {
      test(`js_obj_test_name_${name}`, async () => {
        await builder.run();
      });
    }

    runTest("number", TestBuilder.command`echo ${1}`.stdout("1\n"));
    runTest("String", TestBuilder.command`echo ${new String("1")}`.stdout("1\n"));
    runTest("bool", TestBuilder.command`echo ${true}`.stdout("true\n"));
    runTest("null", TestBuilder.command`echo ${null}`.stdout("null\n"));
    runTest("undefined", TestBuilder.command`echo ${undefined}`.stdout("undefined\n"));
    runTest("Date", TestBuilder.command`echo hello ${new Date()}`.stdout(`hello ${new Date().toString()}\n`));
    runTest("BigInt", TestBuilder.command`echo ${BigInt((2 ^ 52) - 1)}`.stdout(`${BigInt((2 ^ 52) - 1)}\n`));
    runTest("Array", TestBuilder.command`echo ${[1, 2, 3]}`.stdout(`1 2 3\n`));

    test("flattens nested template arrays up to the depth limit", async () => {
      let nested: any = "x";
      for (let i = 0; i < 100; i++) nested = [nested];
      const { stdout } = await $`echo ${nested}`;
      expect(stdout.toString()).toEqual("x\n");
      expect(() => $`echo ${[nested]}`).toThrow(
        "Shell script template arrays cannot be nested more than 100 levels deep",
      );
    });

    test("rejects template arrays nested past the depth limit", () => {
      let nested: any = "x";
      for (let i = 0; i < 101; i++) nested = [nested];
      expect(() => $`echo ${nested}`).toThrow(
        "Shell script template arrays cannot be nested more than 100 levels deep",
      );
    });
  });

  describe("escape", async () => {
    function escapeTest(strToEscape: string, expected: string = strToEscape) {
      test(strToEscape, async () => {
        const { stdout } = await $`echo ${strToEscape}`;
        expect(stdout.toString()).toEqual(`${strToEscape}\n`);
        expect($.escape(strToEscape)).toEqual(expected);
      });
    }

    escapeTest("1 2 3", '"1 2 3"');
    escapeTest("nice\nlmao", '"nice\nlmao"');
    escapeTest(`lol $NICE`, `"lol \\$NICE"`);
    escapeTest(
      `"hello" "lol" "nice"lkasjf;jdfla<>SKDJFLKSF`,
      `"\\"hello\\" \\"lol\\" \\"nice\\"lkasjf;jdfla<>SKDJFLKSF"`,
    );
    escapeTest("✔", "✔");
    escapeTest("lmao=✔", '"lmao=✔"');
    escapeTest("元気かい、兄弟", "元気かい、兄弟");
    escapeTest("d元気かい、兄弟", "d元気かい、兄弟");
    // Strings made only of U+0000-U+00FF code points use JSC's 8-bit (Latin-1)
    // storage; quoting must re-encode those code units to UTF-8, not copy the
    // raw bytes, or every one of them becomes U+FFFD.
    escapeTest("é");
    escapeTest("é;", '"é;"');
    escapeTest("ü;id", '"ü;id"');
    escapeTest("café && ok", '"café && ok"');
    escapeTest("\u0080;\u00ff", '"\u0080;\u00ff"');

    test.each(["é;", "ü;id", "café && ok", "\u0080;\u00ff"])(
      "latin-1 value %p survives $.escape + {raw:} round trip",
      async value => {
        const escaped = $.escape(value);
        expect(escaped).not.toInclude("\uFFFD");
        const { stdout } = await $`echo ${{ raw: escaped }}`;
        expect(stdout.toString()).toEqual(`${value}\n`);
      },
    );

    test("$.escape of an empty string is an empty shell word", async () => {
      expect($.escape("")).toBe('""');
      // `{ raw: $.escape(v) }` must contribute exactly one argv entry, even for "".
      const { stdout } = await $`echo a ${{ raw: $.escape("") }} b`;
      expect(stdout.toString()).toEqual("a  b\n");
    });

    test("$.escape converts its argument to a string, also when there is nothing to escape", () => {
      expect($.escape(1 as any)).toBe('"1"');
      expect($.escape({ toString: () => "a b" } as any)).toBe('"a b"');
      expect($.escape({ toString: () => "plain" } as any)).toBe("plain");
      expect($.escape({ toString: () => "é\u65e5" } as any)).toBe("é\u65e5");
      expect($.escape(new String("plain") as any)).toBe("plain");
      expect([true, null, undefined, NaN].map(value => $.escape(value as any))).toEqual([
        "true",
        "null",
        "undefined",
        "NaN",
      ]);
      // @ts-expect-error
      expect($.escape()).toBe("undefined");
      // A lone surrogate has no UTF-8, so what needs no escaping does not go through it.
      expect($.escape("\ud800")).toBe("\ud800");
      expect($.escape(new String("a\ud800") as any)).toBe("a\ud800");
      expect(() => $.escape(Symbol() as any)).toThrow(
        expect.objectContaining({ name: "TypeError", message: "Cannot convert a symbol to a string" }),
      );
    });

    test("quotes values containing a tab, carriage return, or question mark", async () => {
      expect($.escape("a\tb")).toEqual('"a\tb"');
      expect($.escape("a\rb")).toEqual('"a\rb"');
      expect($.escape("a?b")).toEqual('"a?b"');
      const { stdout } = await $`echo ${"a\tb"} ${"a?b"}`;
      expect(stdout.toString()).toEqual("a\tb a?b\n");
    });

    test("escaped values containing interpolation marker bytes stay literal data", async () => {
      // Interpolated values that need escaping are stored out-of-band and
      // referenced from the script source via an internal `\x08__bunstr_N`
      // marker. A value passed through $.escape() and embedded with `{raw:}`
      // must never be re-interpreted as one of those references, otherwise it
      // would be replaced with a *different* interpolation's value.
      const secret = "name=top-secret-value";
      const hostile = "\x08__bunstr_0";
      const escaped = $.escape(hostile);
      // The escaped form must not contain the bare marker prefix the lexer resolves.
      expect(escaped).not.toContain("\x08__bunstr_");

      const { stdout } = await $`echo ${{ raw: escaped }} ${secret}`;
      expect(stdout.toString()).toEqual(`${hostile} ${secret}\n`);

      // A normal value still round-trips through $.escape() + {raw:}.
      const { stdout: ok } = await $`echo ${{ raw: $.escape("hello world") }}`;
      expect(ok.toString()).toEqual("hello world\n");
    });

    describe("wrapped in quotes", async () => {
      const url = "http://www.example.com?candy_name=M&M";
      TestBuilder.command`echo url="${url}"`.stdout(`url=${url}\n`).runAsTest("double quotes");
      TestBuilder.command`echo url='${url}'`.stdout(`url=${url}\n`).runAsTest("single quotes");
      TestBuilder.command`echo url=${url}`.stdout(`url=${url}\n`).runAsTest("no quotes");
    });

    describe("escape var", async () => {
      const shellvar = "$FOO";
      TestBuilder.command`FOO=bar && echo "${shellvar}"`.stdout(`$FOO\n`).runAsTest("double quotes");
      TestBuilder.command`FOO=bar && echo '${shellvar}'`.stdout(`$FOO\n`).runAsTest("single quotes");
      TestBuilder.command`FOO=bar && echo ${shellvar}`.stdout(`$FOO\n`).runAsTest("no quotes");
    });

    describe("interpolated value after a literal $ stays literal", async () => {
      const name = "FOO";
      TestBuilder.command`FOO=bar && echo $${name}`.stdout(`$FOO\n`).runAsTest("no quotes");
      TestBuilder.command`FOO=bar && echo "$${name}"`.stdout(`$FOO\n`).runAsTest("double quotes");
      TestBuilder.command`FOO=bar && echo a$${name}b`.stdout(`a$FOOb\n`).runAsTest("inside a word");

      test("does not extend a preceding variable name", async () => {
        const { stdout, stderr, exitCode } = await $`FOOBAR=long && FOO=short && echo $FOO${"BAR"}`.env({ ...bunEnv });
        expect(stderr.toString()).toBe("");
        expect(stdout.toString()).toBe("shortBAR\n");
        expect(exitCode).toBe(0);
      });

      test("does not name a variable from the environment", async () => {
        const { stdout, stderr, exitCode } = await $`echo $${"SHELL_TEST_SECRET"}`.env({
          ...bunEnv,
          SHELL_TEST_SECRET: "hunter2",
        });
        expect(stderr.toString()).toBe("");
        expect(stdout.toString()).toBe("$SHELL_TEST_SECRET\n");
        expect(exitCode).toBe(0);
      });
    });

    // The first `${FOO}` of each script is written in the shell source and
    // expands. The second one gets its name, or the end of its name, from an
    // interpolated value and stays text.
    describe("interpolated value after a literal ${ stays literal", () => {
      const source = { raw: "${FOO}" };
      const open = { raw: "${" };
      const name = "FOO";
      TestBuilder.command`FOO=bar && echo ${source} ${open}${name}}`.stdout("bar ${FOO}\n").runAsTest("no quotes");
      TestBuilder.command`FOO=bar && echo "${source} ${open}${name}}"`
        .stdout("bar ${FOO}\n")
        .runAsTest("double quotes");
      TestBuilder.command`FOO=bar && echo ${source} a${open}${name}}b`
        .stdout("bar a${FOO}b\n")
        .runAsTest("inside a word");
      TestBuilder.command`FOO=bar && echo ${source} ${open}${1}}`.stdout("bar ${1}\n").runAsTest("a number");
      TestBuilder.command`FOO=bar && echo ${source} ${open}${["FOO"]}}`.stdout("bar ${FOO}\n").runAsTest("an array");
      TestBuilder.command`FOO=bar && echo ${source} ${open}${{ toString: () => "FOO" }}}`
        .stdout("bar ${FOO}\n")
        .runAsTest("an object with toString");
      TestBuilder.command`FOO=bar && echo ${source} ${open}${Bun.file("FOO")}}`
        .stdout("bar ${FOO}\n")
        .runAsTest("a Bun.file path");
      TestBuilder.command`FOOBAR=long && FOO=short && echo ${source} ${{ raw: "${FOO" }}${Bun.file("BAR")}}`
        .stdout("short ${FOOBAR}\n")
        .runAsTest("a Bun.file path that would complete a name");
      TestBuilder.command`FOO=bar && echo ${source} ${{ raw: "${FOO" }}${":-other"}} ${{ raw: "${NONE:" }}${"-other"}}`
        .stdout("bar ${FOO:-other} ${NONE:-other}\n")
        .runAsTest("a value that would be the operator");
      // A backslash-newline breaks the word today, so this prints `$ {FOO}`.
      TestBuilder.command`FOO=bar && echo ${source} ${{ raw: "$\\\n{" }}${name}}`
        .stdout(stdout => expect(stdout.replace("$ {", "${")).toBe("bar ${FOO}\n"))
        .runAsTest("after a line continuation between $ and {");

      test("does not complete a variable name", async () => {
        const { stdout, stderr, exitCode } =
          await $`FOOBAR=long && FOO=short && echo ${source} ${{ raw: "${FOO" }}${"BAR"}}`.env({ ...bunEnv });
        expect(stderr.toString()).toBe("");
        expect(stdout.toString()).toBe("short ${FOOBAR}\n");
        expect(exitCode).toBe(0);
      });

      test("does not name a variable from the environment", async () => {
        const { stdout, stderr, exitCode } = await $`echo ${source} ${open}${"SHELL_TEST_SECRET"}}`.env({
          ...bunEnv,
          FOO: "bar",
          SHELL_TEST_SECRET: "hunter2",
        });
        expect(stderr.toString()).toBe("");
        expect(stdout.toString()).toBe("bar ${SHELL_TEST_SECRET}\n");
        expect(exitCode).toBe(0);
      });

      test("when $ is called with a strings array", async () => {
        const { stdout, stderr, exitCode } = await $({ raw: ["FOO=bar && echo ${FOO} ${", "}"] } as any, name);
        expect(stderr.toString()).toBe("");
        expect(stdout.toString()).toBe("bar ${FOO}\n");
        expect(exitCode).toBe(0);
      });
    });

    // The template opens the form and its operator. The value is the word, and it is data there.
    describe("interpolated value in the word of a literal ${NAME<op>", () => {
      const open = { raw: "${SHELL_TEST_UNSET:-" };
      TestBuilder.command`echo ${open}${"a; echo INJECTED"}}`.stdout("a; echo INJECTED\n").runAsTest("a command");
      TestBuilder.command`echo ${open}${"$(echo INJECTED) `echo INJECTED` $HOME"}}`
        .stdout("$(echo INJECTED) `echo INJECTED` $HOME\n")
        .runAsTest("a substitution or a variable");
      TestBuilder.command`echo ${open}${"a}b"}}c ${open}${"x y"}}`.stdout("a}bc x y\n").runAsTest("a closing brace");
      TestBuilder.command`echo ${open}${"~"}} ${open}${"*"}} ${open}${"${FOO:-d}"}}`
        .stdout("~ * ${FOO:-d}\n")
        .runAsTest("a tilde, a glob or another form");
      TestBuilder.command`echo ${open}${"plain"}} ${{ raw: "${SHELL_TEST_UNSET:-a" }}${"b"}}`
        .stdout("plain ab\n")
        .runAsTest("plain text");
      TestBuilder.command`true ${{ raw: "${SHELL_TEST_A:=" }}${"$(echo INJECTED)"}}; echo "$SHELL_TEST_A"`
        .stdout("$(echo INJECTED)\n")
        .runAsTest("the value of an assignment");
    });

    test("can't escape a js string/obj ref", async () => {
      const shellvar = "$FOO";
      await TestBuilder.command`FOO=bar && echo \\${shellvar}`.stdout(`\\$FOO\n`).run();
      const buf = new Uint8Array(1);

      expect(async () => {
        await TestBuilder.command`echo hi > \\${buf}`.error("Redirection with no file").run();
      });
    });

    test("in command position", async () => {
      const x = "echo hi";
      await TestBuilder.command`${x}`.exitCode(1).stderr("bun: command not found: echo hi\n").run();
    });

    test("arrays", async () => {
      const x = ["echo", "hi"];
      await TestBuilder.command`${x}`.stdout("hi\n").run();
    });
  });

  describe("quiet", async () => {
    test("basic", async () => {
      // Check its buffered
      {
        const { stdout, stderr } = await $`BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e "console.log('hi'); console.error('lol')"`;
        expect(stdout.toString()).toEqual("hi\n");
        expect(stderr.toString()).toEqual("lol\n");
      }

      // Check it doesn't write to stdout
      const { stdout, stderr } = Bun.spawnSync(
        [
          BUN,
          "-e",
          "await Bun.$`BUN_DEBUG_QUIET_LOGS=1 ${process.argv0} -e \"console.log('hi'); console.error('lol')\"`.quiet()",
        ],
        {
          env: { BUN_DEBUG_QUIET_LOGS: "1" },
        },
      );
      expect(stdout.toString()).toBe("");
      expect(stderr.toString()).toBe("");
    });

    test("cmd subst", async () => {
      await TestBuilder.command`echo $(echo hi)`.quiet().stdout("hi\n").run();
    });

    test.each([
      { value: undefined, expectedQuiet: true, description: "quiet()" },
      { value: true, expectedQuiet: true, description: "quiet(true)" },
      { value: false, expectedQuiet: false, description: "quiet(false)" },
    ])("$description suppresses output: $expectedQuiet", async ({ value, expectedQuiet }) => {
      // Test with spawned process to check actual stdout
      const quietArg = value === undefined ? "" : value.toString();
      const { stdout, stderr } = Bun.spawnSync(
        [BUN, "-e", `await Bun.$\`echo "test output"\`.quiet(${quietArg === undefined ? "" : quietArg})`],
        {
          env: { BUN_DEBUG_QUIET_LOGS: "1" },
        },
      );

      if (expectedQuiet) {
        expect(stdout.toString()).toBe("");
      } else {
        expect(stdout.toString()).toBe("test output\n");
      }
      expect(stderr.toString()).toBe("");
    });
  });

  test("failing stmt edgecase", async () => {
    const { stdout } =
      await $`mkdir foo; touch ./foo/lol ./foo/nice ./foo/lmao; mkdir foo/bar; touch ./foo/bar/great; touch ./foo/bar/wow; ls foo -R`.cwd(
        temp_dir,
      );
  });

  // test("invalid js obj", async () => {
  //   const lol = {
  //     hi: "lmao",
  //   };
  //   await TestBuilder.command`echo foo > ${lol}`.error("Invalid JS object used in shell: [object Object]").run();
  //   const r = new RegExp("hi");
  //   await TestBuilder.command`echo foo > ${r}`.error("Invalid JS object used in shell: /hi/").run();
  // });

  test("empty_input", async () => {
    await TestBuilder.command``.run();
    await TestBuilder.command`     `.run();
    await TestBuilder.command`
`.run();
    await TestBuilder.command`
    `.run();
    await TestBuilder.command`
`.run();
  });

  describe("echo+cmdsubst edgecases", async () => {
    async function doTest(cmd: string, expected: string) {
      test(cmd, async () => {
        const { stdout } = await $`${{ raw: cmd }}`;
        expect(stdout.toString()).toEqual(expected);
      });
    }

    // funny/crazy edgecases thanks to @paperclover and @Electroid
    doTest(`echo "$(echo 1; echo 2)"`, "1\n2\n");
    doTest(`echo "$(echo "1" ; echo "2")"`, "1\n2\n");
    doTest(`echo $(echo 1; echo 2)`, "1 2\n");

    // Issue: #8982
    // https://github.com/oven-sh/bun/issues/8982
    describe("word splitting", async () => {
      TestBuilder.command`echo $(echo id)/$(echo region)`.stdout("id/region\n").runAsTest("concatenated cmd substs");
      TestBuilder.command`echo $(echo hi id)/$(echo region)`
        .stdout("hi id/region\n")
        .runAsTest("cmd subst with whitespace gets split");

      // Make sure its one whole argument
      TestBuilder.command`echo {"console.log(JSON.stringify(process.argv.slice(2)))"} > temp_script.ts; BUN_DEBUG_QUIET_LOGS=1 ${BUN} run temp_script.ts $(echo id)/$(echo region)`
        .stdout('["id/region"]\n')
        .ensureTempDir()
        .runAsTest("make sure its one whole argument");

      // Make sure its two separate arguments
      TestBuilder.command`echo {"console.log(JSON.stringify(process.argv.slice(2)))"} > temp_script.ts; BUN_DEBUG_QUIET_LOGS=1 ${BUN} run temp_script.ts $(echo hi id)/$(echo region)`
        .stdout('["hi","id/region"]\n')
        .ensureTempDir()
        .runAsTest("make sure its two separate arguments");
    });
  });

  describe("unicode", () => {
    test("basic", async () => {
      const whatsupbro = "元気かい、兄弟";
      const { stdout } = await $`echo ${whatsupbro}`;

      expect(stdout.toString("utf8")).toEqual(whatsupbro + "\n");
    });

    test("escape unicode", async () => {
      const { stdout } = await $`echo \\弟\\気`;
      expect(stdout.toString("utf8")).toEqual("\\弟\\気\n");
    });

    /**
     * Only A-Z, a-z, 0-9, and _ are allowed in variable names
     *
     * Using unicode in var name will interpret the assignment as a command.
     */
    //
    test("varname fails", async () => {
      const whatsupbro = "元気かい、兄弟";
      await TestBuilder.command`${whatsupbro}=NICE; echo $${whatsupbro}`
        .stdout("$元気かい、兄弟\n")
        .stderr("bun: command not found: 元気かい、兄弟=NICE\n")
        .run();
    });

    test("var value", async () => {
      const error = await runWithErrorPromise(async () => {
        const whatsupbro = "元気かい、兄弟";
        const { stdout } = await $`FOO=${whatsupbro}; echo $FOO`;
        expect(stdout.toString("utf-8")).toEqual(whatsupbro + "\n");
      });
      expect(error).toBeUndefined();
    });

    test("in compound word", async () => {
      const whatsupbro = "元気かい、兄弟";
      const holymoly = "ホーリーモーリー";
      const { stdout } = await $`echo "${whatsupbro}&&nice"${holymoly}`;

      expect(stdout.toString("utf-8")).toEqual(`${whatsupbro}&&nice${holymoly}\n`);
    });

    test("cmd subst", async () => {
      const haha = "ハハ";
      const { stdout } = await $`echo $(echo ${haha})`;

      expect(stdout.toString("utf-8")).toEqual(`${haha}\n`);
    });

    // #9823
    TestBuilder.command`AUTH_COOKIE_SECUREALKJAKJDLASJDKLSAJD=false; echo $AUTH_COOKIE_SECUREALKJAKJDLASJDKLSAJD`
      .stdout("false\n")
      .runAsTest("long varname");

    // test("invalid lone surrogate fails", async () => {
    //   const err = await runWithErrorPromise(async () => {
    //     const loneSurrogate = randomLoneSurrogate();
    //     const buffer = new Uint8Array(8192);
    //     const result = await $`echo ${loneSurrogate} > ${buffer}`;
    //   });
    //   console.log("ERR", err)
    //   expect(err?.message).toEqual("Shell script string contains invalid UTF-16");
    // });

    // test("invalid surrogate pair fails", async () => {
    //   const err = await runWithErrorPromise(async () => {
    //     const loneSurrogate = randomInvalidSurrogatePair();
    //     const buffer = new Uint8Array(8192);
    //     const result = $`echo ${loneSurrogate} > ${buffer}`;
    //   });
    //   expect(err?.message).toEqual("Shell script string contains invalid UTF-16");
    // });
  });

  describe("latin-1", async () => {
    describe("basic", async () => {
      TestBuilder.command`echo ${"à"}`.stdout("à\n").runAsTest("lone latin-1 character");
      TestBuilder.command`echo ${" à"}`.stdout(" à\n").runAsTest("latin-1 character preceded by space");
      TestBuilder.command`echo ${"à¿"}`.stdout("à¿\n").runAsTest("multiple latin-1 characters");
      TestBuilder.command`echo ${'"à¿"'}`.stdout('"à¿"\n').runAsTest("latin-1 characters in quotes");
      // An ASCII run before the first non-ASCII code unit must not be emitted
      // twice. This shape (ASCII prefix + Latin-1 + no shell metacharacters)
      // takes the no-escape append_latin1_impl path, unlike every case above.
      TestBuilder.command`echo ${"café"}`.stdout("café\n").runAsTest("ascii prefix before a latin-1 character");
      TestBuilder.command`echo ${"résumé"}`.stdout("résumé\n").runAsTest("interleaved ascii and latin-1 runs");
      TestBuilder.command`echo ${{ raw: "café" }}`
        .stdout("café\n")
        .runAsTest("ascii prefix before a latin-1 character via raw");
    });
  });

  test("redirect Uint8Array", async () => {
    const buffer = new Uint8Array(1 << 20);
    const result = await $`cat ${import.meta.path} > ${buffer}`;

    const sentinel = sentinelByte(buffer);
    const thisFile = Bun.file(import.meta.path);

    expect(new TextDecoder().decode(buffer.slice(0, sentinel))).toEqual(await thisFile.text());
  });

  test("redirect Buffer", async () => {
    const buffer = Buffer.alloc(1 << 20);
    const result = await $`cat ${import.meta.path} > ${buffer}`;

    const thisFile = Bun.file(import.meta.path);

    expect(new TextDecoder().decode(buffer.slice(0, sentinelByte(buffer)))).toEqual(await thisFile.text());
  });

  test("redirect Bun.File", async () => {
    const filepath = join(temp_dir, "lmao.txt");
    const file = Bun.file(filepath);
    const thisFileText = await Bun.file(import.meta.path).text();
    const result = await $`cat ${import.meta.path} > ${file}`;

    expect(await file.text()).toEqual(thisFileText);
  });

  test("redirect stdin from a ReadableStream throws", async () => {
    for (const cmd of ["cat", "echo", "true && cat", `${BUN} -e "process.stdin.pipe(process.stdout)"`]) {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("hello from a stream\n"));
          controller.close();
        },
      });
      expect(async () => await $`${{ raw: cmd }} < ${stream}`.env(bunEnv).quiet()).toThrow(
        "ReadableStream is not supported as a shell redirect yet",
      );
    }
    const stream = new Response("hello from a stream\n").body!;
    expect(await $`cat < ${await new Response(stream).blob()}`.text()).toBe("hello from a stream\n");
  });

  // TODO This sometimes fails
  test("redirect stderr", async () => {
    const buffer = Buffer.alloc(128, 0);
    const code = /* ts */ `
    for (let i = 0; i < 10; i++) {
      console.error('LMAO')
    }
    `;

    await $`${BUN} -e ${code} 2> ${buffer}`.env(bunEnv);

    console.log(buffer);
    expect(new TextDecoder().decode(buffer.slice(0, sentinelByte(buffer)))).toEqual(
      `LMAO\nLMAO\nLMAO\nLMAO\nLMAO\nLMAO\nLMAO\nLMAO\nLMAO\nLMAO\n`,
    );
  });

  test("pipeline", async () => {
    const { stdout } = await $`echo "LMAO" | cat`;

    expect(stdout.toString()).toEqual("LMAO\n");
  });

  // The builtin cat is only on by default on Windows; the flag turns it on
  // everywhere. Captured output finishes the command from the reader side,
  // output on a real fd also goes through the writer completions, and the
  // missing-file case with stderr on a fd finishes from the writer side alone.
  test("builtin cat finishes from its reader and writer completions", async () => {
    using dir = tempDir("builtin-cat", {});
    const script = /* ts */ `
      import { $ } from "bun";
      $.nothrow();
      const results = {};
      for (const [name, run] of Object.entries({
        "captured": () => $\`echo hi | cat\`,
        "stdout to fd": () => $\`echo hi | cat > out.txt\`,
        "missing file, stderr captured": () => $\`cat missing.txt\`,
        "missing file, stderr to fd": () => $\`cat missing.txt 2> err.txt\`,
      })) {
        const r = await run().quiet();
        results[name] = { stdout: r.stdout.toString(), stderr: r.stderr.toString(), exitCode: r.exitCode };
      }
      results["out.txt"] = await Bun.file("out.txt").text();
      results["err.txt"] = await Bun.file("err.txt").text();
      console.log(JSON.stringify(results));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    // On Windows the message carries the absolute path (shell_openat only
    // re-tags the error with the argument as written on POSIX).
    const missingFileError = expect.stringMatching(/^cat: (.*[\\/])?missing\.txt: No such file or directory\n$/);
    expect(JSON.parse(stdout)).toEqual({
      "captured": { stdout: "hi\n", stderr: "", exitCode: 0 },
      "stdout to fd": { stdout: "", stderr: "", exitCode: 0 },
      "missing file, stderr captured": { stdout: "", stderr: missingFileError, exitCode: 1 },
      "missing file, stderr to fd": { stdout: "", stderr: "", exitCode: 1 },
      "out.txt": "hi\n",
      "err.txt": missingFileError,
    });
    expect(exitCode).toBe(0);
  });

  // `ulimit -n` caps the fd table of the child so the pipeline cannot create
  // its pipes (EMFILE). The pipeline must print the error on its stderr and
  // finish with exit code 1 so the `$` promise settles and the script goes on,
  // instead of throwing from inside the interpreter and never completing.
  describe.skipIf(isWindows)("pipeline that fails to create its pipes", () => {
    const runWithFdLimit = (limit: number, script: string, env = bunEnv) =>
      Bun.spawn({
        cmd: ["/bin/sh", "-c", `ulimit -n ${limit} && exec "$1" -e "$2"`, "sh", bunExe(), script],
        env,
        stdout: "pipe",
        stderr: "pipe",
      });

    test("reports EMFILE on stderr and finishes with exit code 1", async () => {
      // 24 pipes need 48 fds; the whole process gets 32.
      const pipeline = ["echo hi", ...Array(24).fill("cat")].join(" | ");
      const script = /* ts */ `
        import { $ } from "bun";
        const results = {};
        const record = (name, r) => {
          results[name] = { stdout: r.stdout.toString(), stderr: r.stderr.toString(), exitCode: r.exitCode };
        };
        record("stderr captured", await $\`${pipeline}\`.nothrow().quiet());
        record("stderr on a fd", await $\`${pipeline}\`.nothrow());
        record("script continues", await $\`${pipeline}; echo after\`.nothrow().quiet());
        try {
          await $\`${pipeline}\`.quiet();
          results["throws"] = "did not throw";
        } catch (e) {
          record("throws", e);
        }
        console.log(JSON.stringify(results));
      `;
      await using proc = runWithFdLimit(32, script);
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("bun: Too many open files\n");
      expect(JSON.parse(stdout)).toEqual({
        "stderr captured": { stdout: "", stderr: "bun: Too many open files\n", exitCode: 1 },
        "stderr on a fd": { stdout: "", stderr: "bun: Too many open files\n", exitCode: 1 },
        "script continues": { stdout: "after\n", stderr: "bun: Too many open files\n", exitCode: 0 },
        "throws": { stdout: "", stderr: "bun: Too many open files\n", exitCode: 1 },
      });
      expect(exitCode).toBe(0);
    });

    // Pipelines of growing length against a fixed fd budget. The short ones
    // fit. Past some length the pipes still fit but the per-command `dup` of
    // the cwd fd fails. Past that the pipes themselves fail. Every pipeline
    // must finish, either with its output or with the EMFILE message.
    test("reports EMFILE from the per-command env dup and finishes", async () => {
      const script = /* ts */ `
        import { $ } from "bun";
        const results = [];
        for (let n = 2; n <= 16; n++) {
          const pipeline = ["echo hi", ...Array(n - 1).fill("cat")].join(" | ");
          const r = await $\`\${{ raw: pipeline }}\`.nothrow().quiet();
          results.push({ stdout: r.stdout.toString(), stderr: r.stderr.toString(), exitCode: r.exitCode });
        }
        console.log(JSON.stringify(results));
      `;
      // The builtin cat keeps this to pipes and dups: no subprocess, so no
      // spawn-time fds change the accounting.
      await using proc = runWithFdLimit(32, script, { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      const results = JSON.parse(stdout);
      const ok = { stdout: "hi\n", stderr: "", exitCode: 0 };
      const emfile = { stdout: "", stderr: "bun: Too many open files\n", exitCode: 1 };
      const firstFailure = results.findIndex(r => r.exitCode !== 0);
      expect(firstFailure).toBeGreaterThan(0);
      expect(results).toEqual([...Array(firstFailure).fill(ok), ...Array(results.length - firstFailure).fill(emfile)]);
      expect(exitCode).toBe(0);
    });

    // Same sweep with a subshell at the head. A subshell runs a Script of its
    // own, so if the pipeline started it before a later command's `dup`
    // failed, tearing the pipeline down would leave that Script behind with
    // the subshell's echo still writing into the pipe. The echo then reports
    // to a freed node once the pipe is closed under it. No child may start
    // until every child is set up.
    test("reports EMFILE from the per-command env dup when the head is a subshell", async () => {
      const script = /* ts */ `
        import { $ } from "bun";
        const results = [];
        for (let n = 2; n <= 16; n++) {
          const pipeline = ["(echo hi)", ...Array(n - 1).fill("cat")].join(" | ");
          const r = await $\`\${{ raw: pipeline }}\`.nothrow().quiet();
          results.push({ stdout: r.stdout.toString(), stderr: r.stderr.toString(), exitCode: r.exitCode });
          // One event loop turn, so that a write a torn-down child left in
          // flight completes (and reports) before the next pipeline runs.
          await Bun.sleep(0);
        }
        console.log(JSON.stringify(results));
      `;
      await using proc = runWithFdLimit(32, script, { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      const results = JSON.parse(stdout);
      const ok = { stdout: "hi\n", stderr: "", exitCode: 0 };
      const emfile = { stdout: "", stderr: "bun: Too many open files\n", exitCode: 1 };
      const firstFailure = results.findIndex(r => r.exitCode !== 0);
      expect(firstFailure).toBeGreaterThan(0);
      expect(results).toEqual([...Array(firstFailure).fill(ok), ...Array(results.length - firstFailure).fill(emfile)]);
      expect(exitCode).toBe(0);
    });
  });

  describe("operators no spaces", async () => {
    TestBuilder.command`echo LMAO|cat`.stdout("LMAO\n").runAsTest("pipeline");
    TestBuilder.command`echo foo&&echo hi`.stdout("foo\nhi\n").runAsTest("&&");
    TestBuilder.command`echo foo||echo hi`.stdout("foo\n").runAsTest("||");
    TestBuilder.command`echo foo>hi.txt`.ensureTempDir().fileEquals("hi.txt", "foo\n").runAsTest("||");
    TestBuilder.command`echo hifriends#lol`.stdout("hifriends#lol\n").runAsTest("#");
  });

  test("cmd subst", async () => {
    const haha = "noice";
    const { stdout } = await $`echo $(echo noice)`;
    expect(stdout.toString()).toEqual(`noice\n`);
  });

  describe("empty_expansion", () => {
    TestBuilder.command`$(exit 0) && echo hi`.stdout("hi\n").runAsTest("empty command subst");
    TestBuilder.command`$(exit 1) && echo hi`.exitCode(1).runAsTest("empty command subst 2");
    TestBuilder.command`FOO="" $FOO`.runAsTest("empty var");
  });

  describe("tilde_expansion", () => {
    describe("with paths", async () => {
      TestBuilder.command`echo ~/Documents`.stdout(`${process.env.HOME}/Documents\n`).runAsTest("normal");
      TestBuilder.command`echo ~/Do"cu"me"nts"`.stdout(`${process.env.HOME}/Documents\n`).runAsTest("compound word");
      TestBuilder.command`echo ~/LOL hi hello`.stdout(`${process.env.HOME}/LOL hi hello\n`).runAsTest("multiple words");
    });

    describe("normal", async () => {
      TestBuilder.command`echo ~`.stdout(`${process.env.HOME}\n`).runAsTest("lone tilde");
      TestBuilder.command`echo ~~`.stdout(`~~\n`).runAsTest("double tilde");
      TestBuilder.command`echo ~ hi hello`.stdout(`${process.env.HOME} hi hello\n`).runAsTest("multiple words");
    });

    TestBuilder.command`HOME="" USERPROFILE="" && echo ~ && echo ~/Documents`
      .stdout("\n/Documents\n")
      .runAsTest("empty $HOME or $USERPROFILE");

    describe("modified $HOME or $USERPROFILE", async () => {
      TestBuilder.command`HOME=lmao USERPROFILE=lmao && echo ~`.stdout("lmao\n").runAsTest("1");

      TestBuilder.command`HOME=lmao USERPROFILE=lmao && echo ~ && echo ~/Documents`
        .stdout("lmao\nlmao/Documents\n")
        .runAsTest("2");
    });

    describe("with command substitution", async () => {
      TestBuilder.command`HOME=/home/user USERPROFILE=/home/user && echo ~/$(echo bin)/subdir`
        .stdout("/home/user/bin/subdir\n")
        .runAsTest("atom after cmd subst is preserved");
      TestBuilder.command`HOME=/home/user USERPROFILE=/home/user && echo ~/$(echo a)/$(echo b)/c`
        .stdout("/home/user/a/b/c\n")
        .runAsTest("multiple cmd substs");
      TestBuilder.command`HOME=/home/user USERPROFILE=/home/user && echo ~$(echo /bin)/sub`
        .stdout("/home/user/bin/sub\n")
        .runAsTest("cmd subst immediately after tilde");
      TestBuilder.command`HOME=/home/user USERPROFILE=/home/user && echo ~/$(echo bin)`
        .stdout("/home/user/bin\n")
        .runAsTest("cmd subst as last atom");
    });

    describe("interpolated values", async () => {
      // A `~` that comes from an interpolated value is data, not syntax.
      TestBuilder.command`echo ${"~"}/x`.stdout("~/x\n").runAsTest("interpolated tilde stays literal");
      TestBuilder.command`echo ${"~/secret"}`.stdout("~/secret\n").runAsTest("interpolated tilde path stays literal");
      // A literal `~` in the source after an interpolation keeps its meaning.
      TestBuilder.command`echo ${"a b"}~/x`.stdout("a b~/x\n").runAsTest("literal tilde after interpolated value");
      TestBuilder.command`echo ${"a b"}~bak`
        .stdout("a b~bak\n")
        .runAsTest("backup-suffix idiom after interpolated value");
    });
  });

  // Ported from GNU bash "quote.tests"
  // https://github.com/bminor/bash/blob/f3b6bd19457e260b65d11f2712ec3da56cef463f/tests/quote.tests#L1
  // Some backtick tests are skipped, because of insane behavior:
  // For some reason, even though $(...) and `...` are suppoed to be equivalent,
  // doing:
  // echo "`echo 'foo\
  // bar'`"
  //
  // gives:
  // foobar
  //
  // While doing the same, but with $(...):
  // echo "$(echo 'foo\
  // bar')"
  //
  // gives:
  // foo\
  // bar
  //
  // I'm not sure why, this isn't documented behavior, so I'm choosing to ignore it.
  describe("gnu_quote", () => {
    // An unfortunate consequence of our use of String.raw and tagged template
    // functions for the shell make it so that we have to use { raw: string } to do
    // backtick command substitution
    const BACKTICK = { raw: "`" };

    // Single Quote
    TestBuilder.command`
echo 'foo
bar'
echo 'foo
bar'
echo 'foo\
bar'
`
      .stdout("foo\nbar\nfoo\nbar\nfoo\\\nbar\n")
      .runAsTest("Single Quote");

    TestBuilder.command`
echo "foo
bar"
echo "foo
bar"
echo "foo\
bar"
`
      .stdout("foo\nbar\nfoo\nbar\nfoobar\n")
      .runAsTest("Double Quote");

    TestBuilder.command`
echo ${BACKTICK}echo 'foo
bar'${BACKTICK}
echo ${BACKTICK}echo 'foo
bar'${BACKTICK}
echo ${BACKTICK}echo 'foo\
bar'${BACKTICK}
`
      .stdout(
        `foo bar
foo bar
foobar\n`,
      )
      .todo("insane backtick behavior")
      .runAsTest("Backslash Single Quote");

    TestBuilder.command`
echo "${BACKTICK}echo 'foo
bar'${BACKTICK}"
echo "${BACKTICK}echo 'foo
bar'${BACKTICK}"
echo "${BACKTICK}echo 'foo\
bar'${BACKTICK}"
`
      .stdout(
        `foo
bar
foo
bar
foobar\n`,
      )
      .todo("insane backtick behavior")
      .runAsTest("Double Quote Backslash Single Quote");

    TestBuilder.command`
echo $(echo 'foo
bar')
echo $(echo 'foo
bar')
echo $(echo 'foo\
bar')
`
      .stdout(
        `foo bar
foo bar
foo\\ bar\n`,
      )
      .runAsTest("Dollar Paren Single Quote");

    TestBuilder.command`
echo "$(echo 'foo
bar')"
echo "$(echo 'foo
bar')"
echo "$(echo 'foo\
bar')"
`
      .stdout(
        `foo
bar
foo
bar
foo\\
bar\n`,
      )
      .runAsTest("Dollar Paren Double Quote");

    TestBuilder.command`
echo "$(echo 'foo
bar')"
echo "$(echo 'foo
bar')"
echo "$(echo 'foo\
bar')"
`
      .stdout(
        `foo
bar
foo
bar
foo\\
bar\n`,
      )
      .runAsTest("Double Quote Dollar Paren Single Quote");
  });

  describe("escaped_newline", () => {
    const printArgs = /* ts */ `console.log(JSON.stringify(process.argv))`;

    TestBuilder.command /* sh */ `${BUN} run ./code.ts hi hello \
    on a newline!
  `
      .ensureTempDir()
      .file("code.ts", printArgs)
      .stdout(out => expect(JSON.parse(out).slice(2)).toEqual(["hi", "hello", "on", "a", "newline!"]))
      .runAsTest("single");

    TestBuilder.command /* sh */ `${BUN} run ./code.ts hi hello \
    on a newline! \
    and \
    a few \
    others!
  `
      .ensureTempDir()
      .file("code.ts", printArgs)
      .stdout(out =>
        expect(JSON.parse(out).slice(2)).toEqual(["hi", "hello", "on", "a", "newline!", "and", "a", "few", "others!"]),
      )
      .runAsTest("many");

    TestBuilder.command /* sh */ `${BUN} run ./code.ts hi hello \
    on a newline! \
    ooga"
booga"
  `
      .ensureTempDir()
      .file("code.ts", printArgs)
      .stdout(out => expect(JSON.parse(out).slice(2)).toEqual(["hi", "hello", "on", "a", "newline!", "ooga\nbooga"]))
      .runAsTest("quotes");
  });

  describe("glob expansion", () => {
    // Issue #8403: https://github.com/oven-sh/bun/issues/8403
    TestBuilder.command`ls *.sdfljsfsdf`
      .exitCode(1)
      .stderr("bun: no matches found: *.sdfljsfsdf\n")
      .runAsTest("No matches should fail");

    TestBuilder.command`FOO=*.lolwut; echo $FOO`
      .stdout("*.lolwut\n")
      .runAsTest("No matches in assignment position should print out pattern");

    TestBuilder.command`FOO=hi*; echo $FOO`
      .ensureTempDir()
      .stdout("hi*\n")
      .runAsTest("Trailing asterisk with no matches");

    TestBuilder.command`touch hihello; touch hifriends; FOO=hi*; echo $FOO`
      .ensureTempDir()
      .stdout(s => expect(s).toBeOneOf(["hihello hifriends\n", "hifriends hihello\n"]))
      .runAsTest("Trailing asterisk with matches, inline");

    TestBuilder.command`ls *.js`
      // Calling `ensureTempDir()` changes the cwd here
      .ensureTempDir()
      .file("foo.js", "foo")
      .file("bar.js", "bar")
      .stdout(out => {
        expect(sortedShellOutput(out)).toEqual(sortedShellOutput("foo.js\nbar.js\n"));
      })
      .runAsTest("Should work with a different cwd");

    describe("interpolated values cannot inject glob syntax", () => {
      // Only `*`/`**` written literally in the template act as glob syntax.
      // Metacharacters arriving via `${...}` interpolation are data and must
      // match only files containing them literally.
      TestBuilder.command`echo ${"**/"}*`
        .ensureTempDir()
        .file("f.txt", "f")
        .directory("sub")
        .file("sub/deep.txt", "deep")
        .exitCode(1)
        .stderr("bun: no matches found: **/*\n")
        .runAsTest("injected ** does not recurse");

      TestBuilder.command`echo a${"?"}*`
        .ensureTempDir()
        .file("ax.txt", "ax")
        .exitCode(1)
        .stderr("bun: no matches found: a?*\n")
        .runAsTest("injected ? is literal");

      TestBuilder.command`echo ${"!keep"}*`
        .ensureTempDir()
        .file("keep.txt", "")
        .file("other.txt", "")
        .file("!keep1.txt", "")
        .stdout(out => {
          expect(out).toContain("!keep1.txt");
          expect(out).not.toContain("other.txt");
          // `!keep1.txt` does not contain the substring `keep.txt`, so this
          // asserts the un-negated `keep.txt` fixture was not matched.
          expect(out).not.toContain("keep.txt");
        })
        .runAsTest("injected leading ! does not negate");

      TestBuilder.command`echo a${"[bc]"}*`
        .ensureTempDir()
        .file("ab.txt", "")
        .file("ac.txt", "")
        .file("a[bc].txt", "")
        .stdout(out => {
          expect(out).toContain("a[bc].txt");
          expect(out).not.toContain("ab.txt");
          expect(out).not.toContain("ac.txt");
        })
        .runAsTest("injected [...] is literal");

      TestBuilder.command`echo ${"foo"}*`
        .ensureTempDir()
        .file("foo1.txt", "")
        .file("foo2.txt", "")
        .file("bar.txt", "")
        .stdout(out => {
          expect(out).toContain("foo1.txt");
          expect(out).toContain("foo2.txt");
          expect(out).not.toContain("bar.txt");
        })
        .runAsTest("plain interpolation followed by a literal * still globs");

      TestBuilder.command`echo **/*.txt`
        .ensureTempDir()
        .file("a.txt", "")
        .directory("sub")
        .file("sub/b.txt", "")
        .stdout(out => {
          expect(out.replaceAll("\\", "/")).toContain("sub/b.txt");
        })
        .runAsTest("literal ** still recurses");

      // A run of interpolated `!` longer than the matcher's brace-nesting
      // limit (10) must still match literally: neutralizing every `!` as its
      // own `{!}` group used to overflow the brace stack and turn the whole
      // word into "no matches found".
      const bangRun = Buffer.alloc(11, "!").toString();

      TestBuilder.command`echo prefix${bangRun}*`
        .ensureTempDir()
        .file(`prefix${bangRun}x.txt`, "")
        .file("prefixy.txt", "")
        .stdout(out => {
          expect(out).toContain(`prefix${bangRun}x.txt`);
          expect(out).not.toContain("prefixy.txt");
        })
        .runAsTest("long run of injected ! inside a word stays literal");

      TestBuilder.command`echo ${bangRun}keep*`
        .ensureTempDir()
        .file(`${bangRun}keep1.txt`, "")
        .file("keep2.txt", "")
        .stdout(out => {
          expect(out).toContain(`${bangRun}keep1.txt`);
          expect(out).not.toContain("keep2.txt");
        })
        .runAsTest("long leading run of injected ! stays literal");

      // `Bun.Glob` has extglob groups. In the shell, parentheses in a word are always data.
      for (const injected of ["@()!(zzz)", "!(zzz)", "a!(zzz)", "@(a|aa|b)", "+(a)", "?(a)a", "*(a)", "*(a|b)"]) {
        TestBuilder.command`echo ${injected}/f.*`
          .ensureTempDir()
          .directory("a")
          .file("a/f.txt", "")
          .directory("aa")
          .file("aa/f.txt", "")
          .directory("b")
          .file("b/f.txt", "")
          .exitCode(1)
          .stderr(`bun: no matches found: ${injected}/f.*\n`)
          .runAsTest(`injected ${injected} is literal`);
      }

      TestBuilder.command`V=${"@()!(zzz)"}; echo "$V"/f.* || echo $(echo ${"+(a)"})/f.*`
        .ensureTempDir()
        .directory("a")
        .file("a/f.txt", "")
        .exitCode(1)
        .stderr("bun: no matches found: @()!(zzz)/f.*\nbun: no matches found: +(a)/f.*\n")
        .runAsTest("an extglob group from a variable or a command substitution is literal");

      const withParentheses = (out: string) => expect(out.replaceAll("\\", "/")).toBe("c++(old)/f.ts\n");
      const inFolderWithParentheses = (builder: ReturnType<typeof TestBuilder.command>) =>
        builder.ensureTempDir().directory("c++(old)").file("c++(old)/f.ts", "").directory("c").file("c/f.ts", "");

      inFolderWithParentheses(TestBuilder.command`echo ${"c++(old)"}/*.ts`)
        .stdout(withParentheses)
        .runAsTest("an interpolated folder name with parentheses still matches that folder");
      inFolderWithParentheses(TestBuilder.command`echo "c++(old)"/*.ts`)
        .stdout(withParentheses)
        .runAsTest("a double-quoted folder name with parentheses still matches that folder");
      inFolderWithParentheses(TestBuilder.command`echo 'c++(old)'/*.ts`)
        .stdout(withParentheses)
        .runAsTest("a single-quoted folder name with parentheses still matches that folder");

      test.skipIf(isWindows)("a quoted name with parentheses that is a symlink to a folder still expands", async () => {
        using dir = tempDir("bunshell-symlink-parentheses", { "real/f.ts": "" });
        symlinkSync("real", join(String(dir), "Dropbox (Personal)"));
        const { stdout, exitCode } = await $`echo "Dropbox (Personal)"/f.* ${"Dropbox (Personal)"}/*.ts`
          .cwd(String(dir))
          .nothrow()
          .quiet();
        expect(stdout.toString()).toBe("Dropbox (Personal)/f.ts Dropbox (Personal)/f.ts\n");
        expect(exitCode).toBe(0);
      });

      TestBuilder.command`echo *"(1)".ts`
        .ensureTempDir()
        .file("g(1).ts", "")
        .file("g1.ts", "")
        .file("1.ts", "")
        .stdout("g(1).ts\n")
        .runAsTest("a literal * before quoted parentheses isn't an extglob group");
    });

    test("glob on a nonexistent absolute directory does not crash the process", async () => {
      const missing = join(tmpdirSync(), "does-not-exist").replaceAll("\\", "/");
      const script = `
        import { $ } from "bun";
        const missing = ${JSON.stringify(missing)};
        const results = [];

        {
          const r = await $\`echo \${missing}/*\`.nothrow().quiet();
          results.push({ exitCode: r.exitCode, stderr: r.stderr.toString() });
        }

        try {
          await $\`echo \${missing}/*\`.quiet();
          results.push({ threw: false });
        } catch (e) {
          results.push({ threw: true, exitCode: e.exitCode, stderr: e.stderr.toString() });
        }

        {
          const r = await $\`FOO=\${missing}/*; echo $FOO\`.nothrow().quiet();
          results.push({ exitCode: r.exitCode, stdout: r.stdout.toString() });
        }

        console.log(JSON.stringify(results));
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual([
        { exitCode: 1, stderr: `bun: no matches found: ${missing}/*\n` },
        { threw: true, exitCode: 1, stderr: `bun: no matches found: ${missing}/*\n` },
        { exitCode: 0, stdout: `${missing}/*\n` },
      ]);
      expect(exitCode).toBe(0);
    });

    test.if(isPosix && !isRoot)("glob over an unreadable directory reports the real error", async () => {
      await using dir = tempDir("glob-eacces", { "placeholder.txt": "" });
      const noaccess = join(dir, "noaccess").replaceAll("\\", "/");
      mkdirSync(noaccess);
      chmodSync(noaccess, 0o000);
      try {
        const { stderr, exitCode } = await $`echo ${noaccess}/*`.quiet().nothrow();
        expect(stderr.toString()).toContain(`bun: Permission denied: ${noaccess}`);
        expect(stderr.toString()).not.toContain("no matches found");
        expect(exitCode).toBe(1);

        const assign = await $`FOO=${noaccess}/*; echo $FOO`.quiet().nothrow();
        expect(assign.stderr.toString()).toBe("");
        expect(assign.stdout.toString()).toBe(`${noaccess}/*\n`);
        expect(assign.exitCode).toBe(0);
      } finally {
        chmodSync(noaccess, 0o755);
      }
    });

    // As in sh, the whole word expands first, and then the pattern of each of its fields.
    describe("in each field of a word that whitespace splits", () => {
      test.each([
        [["qa"], "*$(echo a b)", ["qa", "b"]],
        [["qa", "b"], "*$(echo a b)", ["qa", "b"]],
        [["qa"], "*`echo a b`", ["qa", "b"]],
        [["qa"], "*$(echo a b)$(echo c d)", ["qa", "bc", "d"]],
        [["qxa", "byc", "dz"], "q*$(echo a b)*$(echo c d)*", ["qxa", "byc", "dz"]],
        [["qa", "bqc"], "$(echo a b)*$(echo c d)", ["a", "bqc", "d"]],
        [["a.txt", "b.md"], "*.txt${U:- *.md}", ["a.txt", "b.md"]],
        [["a.txt"], "*.txt${U:- x}", ["a.txt", "x"]],
        [["qa"], '${U:-"" }*', ["", "qa"]],
        // Each `$(...)` of the word runs before the first walk.
        [[], 'n*$(echo ".txt x")$(touch new.txt)', ["new.txt", "x"]],
        [[], "n*.txt${U:- $(touch new.txt)}", ["new.txt"]],
        // A `*` that the script does not have is data in each field.
        [["qa", "qb"], '*$(echo "a *b")', ["qa", "*b"]],
        [["qa"], '"*"$(echo a b)', ["*a", "b"]],
        // A field with no `*` of the script gets no walk, and a word with one field is as before.
        [["qa"], "${U:+*.none}x$(echo a b)", ["xa", "b"]],
        [["qa"], "*$(true)", ["qa"]],
        // A pattern with no match fails the word, in each field.
        [["qa"], "*zzz$(echo a b)", "bun: no matches found: *zzza\n"],
        [["qa"], "*$(echo a zz)*$(echo b c)", "bun: no matches found: zz*b\n"],
        [["qa"], "$(echo a b)*", "bun: no matches found: b*\n"],
        // An error of the word comes before the walk of a field.
        [["a.new"], '*.n$(echo "ew y")${V:?boom}', "bun: V: boom\n"],
      ])("in %j, %s", async (files, word, expected) => {
        expect(await argvIn(files, word)).toEqual(expected);
      });

      TestBuilder.command`echo hi > ${{ raw: "*$(echo a b)" }}; ls`
        .ensureTempDir()
        .file("qa", "")
        .stderr("bun: ambiguous redirect: at `echo`\n")
        .stdout("qa\n")
        .runAsTest("a redirect target with two fields is ambiguous");

      test.if(isPosix && !isRoot)(
        "a walk that fails in a field after the first one reports the real error",
        async () => {
          await using dir = tempDir("glob-field-eacces", { "qa": "" });
          const noaccess = join(dir, "noaccess");
          mkdirSync(noaccess);
          chmodSync(noaccess, 0o000);
          try {
            const { stdout, stderr, exitCode } = await $`echo q*$(echo a noaccess/)*`.cwd(String(dir)).quiet();
            expect({ stdout: stdout.toString(), stderr: stderr.toString(), exitCode }).toEqual({
              stdout: "",
              stderr: expect.stringMatching(/^bun: Permission denied: .*noaccess/),
              exitCode: 1,
            });
          } finally {
            chmodSync(noaccess, 0o755);
          }
        },
      );
    });
  });

  describe("brace expansion", () => {
    function doTest(pattern: string, expected: string) {
      test(pattern, async () => {
        const { stdout } = await $`echo ${{ raw: pattern }} `;
        expect(stdout.toString()).toEqual(`${expected}\n`);
      });
    }

    describe("concatenated", () => {
      doTest("{a,b,c}{d,e,f}", "ad ae af bd be bf cd ce cf");
    });

    describe("nested", () => {
      doTest("{a,b,{c,d}}", "a b c d");
      doTest("{a,b,{c,d,{e,f}}}", "a b c d e f");
      doTest("{a,{b,{c,d}}}", "a b c d");
      doTest("{a,b,HI{c,e,LMAO{d,f}Q}}", "a b HIc HIe HILMAOdQ HILMAOfQ");
      doTest("{a,{b,c}}{1,2,3}", "a1 a2 a3 b1 b2 b3 c1 c2 c3");
      doTest("{a,{b,c}HEY,d}{1,2,3}", "a1 a2 a3 bHEY1 bHEY2 bHEY3 cHEY1 cHEY2 cHEY3 d1 d2 d3");
      doTest("{a,{b,c},d}{1,2,3}", "a1 a2 a3 b1 b2 b3 c1 c2 c3 d1 d2 d3");

      doTest(
        "{a,b,HI{c,e,LMAO{d,f}Q}}{1,2,{3,4},5}",
        "a1 a2 a3 a4 a5 b1 b2 b3 b4 b5 HIc1 HIc2 HIc3 HIc4 HIc5 HIe1 HIe2 HIe3 HIe4 HIe5 HILMAOdQ1 HILMAOdQ2 HILMAOdQ3 HILMAOdQ4 HILMAOdQ5 HILMAOfQ1 HILMAOfQ2 HILMAOfQ3 HILMAOfQ4 HILMAOfQ5",
      );

      doTest(
        `{1,{2,{3,{4,{5,{6,{7,{8,{9,{10,{11,{12,{13,{14,{15,{16,{17}}}}}}}}}}}}}}}}}`,
        "1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 {17}",
      );
    });

    test("command", async () => {
      const { stdout } = await $`{echo,a,b,c} {d,e,f}`;
      expect(stdout.toString()).toEqual("a b c d e f\n");
    });

    test("a word with more than 65535 tokens fails", async () => {
      const word = "{" + Array(32768).fill("a").join(",") + "}";
      const { stderr, exitCode } = await $`echo ${{ raw: word }}`.quiet().nothrow();
      expect(stderr.toString()).toBe("bun: unexpected token while expanding braces\n");
      expect(exitCode).toBe(1);
    });

    // As in bash, a group expands before the word splits: each variant has the fields of the word.
    describe("in a word that whitespace splits", () => {
      test.each([
        [[], "{x,y}$(echo a b)", ["xa", "b", "ya", "b"]],
        [[], "$(echo 1 2){a,b}", ["1", "2a", "1", "2b"]],
        [[], "{a,b}${U:-c }", ["ac", "bc"]],
        [[], "{a,b}${U:- c}", ["a", "c", "b", "c"]],
        [[], "{a,$(echo 'b c')}", ["a", "b", "c"]],
        [[], "{a$(echo 'x y'),b}", ["ax", "y", "b"]],
        [[], "{a,${U:-b c}}", ["a", "b", "c"]],
        [[], '{"",x}${U:- }y', ["", "y", "x", "y"]],
        [[], '${U:-"" }{a,b}', ["", "a", "", "b"]],
        // A pattern of a variant gets its walk.
        [["qa"], "*$(echo a b){x,y}", ["qa", "bx", "qa", "by"]],
        [["qa"], "q*${U:- }{a,b}", ["qa", "a", "qa", "b"]],
        [["ax", "bx", "cx"], "{a,b,c}*$(echo x y)", ["ax", "y", "bx", "y", "cx", "y"]],
        [["qa"], "{q*,zzz*}$(echo a b)", "bun: no matches found: zzz*a\n"],
        // A group with no `,` is text.
        [["qa"], "*$(echo a b){x},y", ["qa", "b{x},y"]],
        [[], "{x}$(echo a b)", ["{x}a", "b"]],
        [[], "a,b$(echo c d)", ["a,bc", "d"]],
      ])("in %j, %s", async (files, word, expected) => {
        expect(await argvIn(files, word)).toEqual(expected);
      });

      test("an interpolated value is data in each variant", async () => {
        const values = ["{x,y}", "a,b", "\\", "\x01*", "\x01|", '\x01"'];
        for (const value of values) {
          const { stdout, stderr } = await $`${BUN} -e ${printArgv} {l,r}${value}$(echo 1 2)`.quiet();
          expect(stderr.toString()).toBe("");
          expect(JSON.parse(stdout.toString())).toEqual([`l${value}1`, "2", `r${value}1`, "2"]);
        }
      });

      test("more variants than the limit fail the word", async () => {
        const word = Buffer.alloc(17 * 5, "{a,b}").toString() + "$(echo 1 2)";
        const { stderr, exitCode } = await $`echo ${{ raw: word }}`.quiet();
        expect(stderr.toString()).toBe("bun: too many brace expansions (131072 > 65536)\n");
        expect(exitCode).toBe(1);
      });
    });
  });

  describe("variables", () => {
    test("cmd_local_var", async () => {
      const { stdout } = await $`FOO=bar BOOP=1 ${BUN} -e "console.log(JSON.stringify(process.env))"`;
      const str = stdout.toString();
      expect(JSON.parse(str)).toEqual({
        ...bunEnv,
        FOO: "bar",
        BOOP: "1",
      });
    });

    test("expand shell var", async () => {
      const { stdout } = await $`FOO=bar BAR=baz; echo $FOO $BAR`;
      const str = stdout.toString();

      expect(str).toEqual("bar baz\n");
    });

    test("shell var", async () => {
      const { stdout } = await $`FOO=bar BAR=baz && BAZ=1 ${BUN} -e "console.log(JSON.stringify(process.env))"`;
      const str = stdout.toString();

      const procEnv = JSON.parse(str);
      expect(procEnv.FOO).toBeUndefined();
      expect(procEnv.BAR).toBeUndefined();
      expect(procEnv).toEqual({ ...bunEnv, BAZ: "1" });
    });

    test("export var", async () => {
      const buffer = Buffer.alloc(1 << 20);
      const buffer2 = Buffer.alloc(1 << 20);
      await $`export FOO=bar && BAZ=1 ${BUN} -e "console.log(JSON.stringify(process.env))" > ${buffer} && BUN_TEST_VAR=1 ${BUN} -e "console.log(JSON.stringify(process.env))" > ${buffer2}`;

      const str1 = stringifyBuffer(buffer);
      const str2 = stringifyBuffer(buffer2);

      console.log("Str1", str1);

      let procEnv = JSON.parse(str1);
      expect(procEnv).toEqual({ ...bunEnv, BAZ: "1", FOO: "bar" });
      procEnv = JSON.parse(str2);
      expect(procEnv).toEqual({
        ...bunEnv,
        BAZ: "1",
        FOO: "bar",
        BUN_TEST_VAR: "1",
      });
    });

    test("syntax edgecase", async () => {
      const buffer = new Uint8Array(1 << 20);
      const shellProc = await $`FOO=bar BUN_TEST_VAR=1 ${BUN} -e "console.log(JSON.stringify(process.env))"> ${buffer}`;

      const str = stringifyBuffer(buffer);

      const procEnv = JSON.parse(str);

      expect(procEnv).toEqual({ ...bunEnv, BUN_TEST_VAR: "1", FOO: "bar" });
    });

    // `${` in a JS template literal starts an interpolation, so `{ raw }`
    // carries the braced forms to the shell.
    describe("${NAME}", () => {
      const raw = (src: string) => TestBuilder.command`${{ raw: src }}`;

      raw("FOO=bar; echo ${FOO}").stdout("bar\n").runAsTest("expands like $NAME");
      raw('FOO=bar; echo "${FOO}"').stdout("bar\n").runAsTest("in double quotes");
      raw('FOO="a  b"; echo "x ${FOO} y"').stdout("x a  b y\n").runAsTest("in double quotes beside text");
      raw("FOO=bar; echo a${FOO}b").stdout("abarb\n").runAsTest("inside a word");
      raw("FOO=bar; FOObar=no; echo ${FOO}bar").stdout("barbar\n").runAsTest("the braces end the name");
      raw("FOO=a; BAR=b; echo ${FOO}${BAR}$FOO").stdout("aba\n").runAsTest("beside other variables");
      raw("echo a${SHELL_TEST_UNSET}b").stdout("ab\n").runAsTest("unset is empty");
      raw("echo '${FOO}' \\${FOO}").stdout("${FOO} ${FOO}\n").runAsTest("quoted or escaped stays text");

      raw("echo ${FOO}; FOO=bar; echo ${FOO}").stdout("\nbar\n").runAsTest("reads the value when the command runs");
      raw("FOO=a; FOO=b; echo ${FOO}").stdout("b\n").runAsTest("after a second assignment");
      raw("FOO=a; (FOO=b; echo ${FOO}); echo ${FOO}").stdout("b\na\n").runAsTest("in a subshell");
      raw("FOO=bar; echo $(echo ${FOO}) `echo ${FOO}`").stdout("bar bar\n").runAsTest("in a command substitution");
      raw("FOO=bar; BAR=${FOO}; echo $BAR").stdout("bar\n").runAsTest("as an assignment value");
      raw("FOO=echo; ${FOO} hi").stdout("hi\n").runAsTest("as the command name");
      raw("FOO=bar; echo hi > out_${FOO}.txt")
        .ensureTempDir()
        .fileEquals("out_bar.txt", "hi\n")
        .runAsTest("in a redirect target");
      raw("FOO=bar; echo ${FOO}{a,b} {${FOO},c} {a,b}")
        .stdout("bara barb bar c a b\n")
        .runAsTest("beside a brace group");
      raw("[[ -n ${SHELL_TEST_UNSET} ]]").exitCode(1).runAsTest("unset in [[ -n ]]");
      raw("FOO=bar; [[ -n ${FOO} ]] && [[ ${FOO} == bar ]] && echo yes").stdout("yes\n").runAsTest("set in [[ ]]");
      raw("mkdir sub && cd sub && echo ${PWD} && echo $PWD")
        .ensureTempDir()
        .stdout(stdout => {
          const [braced, bare] = stdout.split("\n");
          expect(braced).toEndWith("sub");
          expect(braced).toBe(bare);
        })
        .runAsTest("${PWD} after cd");
      raw("echo ${SHELL_TEST_X%a} ${#SHELL_TEST_X} ${SHELL_TEST_X/a/b} ${10}")
        .stdout("${SHELL_TEST_X%a} ${#SHELL_TEST_X} ${SHELL_TEST_X/a/b} ${10}\n")
        .runAsTest("the forms that are not read stay text");

      test("reads an environment set with .env()", async () => {
        const { stdout, stderr, exitCode } = await $`echo ${{ raw: "${FOO}" }}`.env({ ...bunEnv, FOO: "bar" });
        expect(stderr.toString()).toBe("");
        expect(stdout.toString()).toBe("bar\n");
        expect(exitCode).toBe(0);
      });

      test("is one argument of a command", async () => {
        const words = { raw: '"${FOO}" x${BAR}y ${BAR}' };
        const { stdout, stderr, exitCode } = await $`FOO="a  b"; BAR=c; ${BUN} -e ${printArgv} ${words}`;
        expect(stderr.toString()).toBe("");
        expect(JSON.parse(stdout.toString())).toEqual(["a  b", "xcy", "c"]);
        expect(exitCode).toBe(0);
      });

      // sh gives one empty argument for a double-quoted expansion that is
      // empty. Bun's shell gives none, for "$NAME" too.
      test('empty in double quotes is what "$NAME" is', async () => {
        const braced = { raw: 'a "${SHELL_TEST_UNSET}" "${EMPTY}" b' };
        const bare = { raw: 'a "$SHELL_TEST_UNSET" "$EMPTY" b' };
        const run = (words: { raw: string }) => $`EMPTY=; ${BUN} -e ${printArgv} ${words}`.text();
        expect(await run(braced)).toBe(await run(bare));
      });

      // sh gives one empty word. Bun's shell drops the word, for "$NAME" too. #44904 changes both.
      raw('echo a "${SHELL_TEST_UNSET}" b')
        .stdout("a  b\n")
        .todo("needs #44904")
        .runAsTest("unset in double quotes is one empty word");
      raw('FOO=; echo a "${FOO}" b')
        .stdout("a  b\n")
        .todo("needs #44904")
        .runAsTest("empty in double quotes is one empty word");
      raw('echo a "${SHELL_TEST_UNSET:-}" b')
        .stdout("a  b\n")
        .todo("needs #44904")
        .runAsTest("a form in double quotes that expands to nothing is one empty word");
    });

    describe("${NAME<op>word}", () => {
      const raw = (src: string) => TestBuilder.command`${{ raw: src }}`;
      // The arguments that the words of `src` give, after the assignments in `setup`.
      const argvOf = async (src: string, setup = "") => {
        const { stdout, stderr } = await $`${{ raw: setup }} ${BUN} -e ${printArgv} ${{ raw: src }}`;
        expect(stderr.toString()).toBe("");
        return JSON.parse(stdout.toString());
      };
      // The arguments that each of `words` gives, from one command. `E` is empty and HOME is /home/user.
      const fieldsOf = async (words: string[], cwd = process.cwd()) => {
        const { stdout, stderr } = await $`E=; ${BUN} -e ${printArgv} ${{ raw: words.join(" @@ ") }}`
          .cwd(cwd)
          .env({ ...bunEnv, HOME: "/home/user", USERPROFILE: "/home/user" })
          .quiet();
        expect(stderr.toString()).toBe("");
        const fields: string[][] = [[]];
        for (const arg of JSON.parse(stdout.toString())) arg === "@@" ? fields.push([]) : fields.at(-1)!.push(arg);
        return fields;
      };

      // The result for a parameter that is not set, is empty, or is `v`. `!`: the command fails.
      const results: Record<string, [string, string, string]> = {
        ":-": ["w", "w", "v"],
        "-": ["w", "", "v"],
        ":+": ["", "", "w"],
        "+": ["", "w", "w"],
        ":=": ["w", "w", "v"],
        "=": ["w", "", "v"],
        ":?": ["!", "!", "v"],
        "?": ["!", "", "v"],
      };
      const cells = Object.entries(results).flatMap(([op, byState], row) =>
        (["unset", "empty", "set"] as const).map((state, column) => {
          const name = `SHELL_TEST_P${row}${column}`;
          const result = byState[column];
          const assigns = op.endsWith("=") && result === "w";
          return {
            op,
            id: `${op} ${state}`,
            name,
            setup: state === "unset" ? "" : state === "empty" ? `${name}=; ` : `${name}=v; `,
            form: "${" + name + op + "w}",
            result,
            after: assigns ? "w" : state === "set" ? "v" : "",
            error: `bun: ${name}: w\n`,
          };
        }),
      );

      test.each([
        ["an argument", (form: string) => `echo "$ID" .${form}.`],
        ["an argument in double quotes", (form: string) => `echo "$ID" ".${form}."`],
      ])("every operator as %s", async (_name, command) => {
        const script = cells
          .map(cell => `${cell.setup}ID="${cell.id}"; ${command(cell.form)} "[$${cell.name}]"`)
          .join("\n");
        const { stdout, stderr, exitCode } = await $`${{ raw: script }}`;
        expect(stdout.toString()).toBe(
          cells
            .filter(cell => cell.result !== "!")
            .map(cell => `${cell.id} .${cell.result}. [${cell.after}]\n`)
            .join(""),
        );
        expect(stderr.toString()).toBe(
          cells
            .filter(cell => cell.result === "!")
            .map(cell => cell.error)
            .join(""),
        );
        expect(exitCode).toBe(0);
      });

      test.each([
        ["an assignment", (form: string) => `VALUE=${form}; `, (result: string) => result],
        ["an assignment in double quotes", (form: string) => `VALUE=".${form}."; `, (result: string) => `.${result}.`],
        // An assignment before a command is for that command only.
        ["an assignment before a command", (form: string) => `VALUE=${form} true; `, () => "none"],
      ])("every operator in the value of %s", async (_name, assign, value) => {
        const script = cells
          .map(cell => `${cell.setup}VALUE=none; ${assign(cell.form)}echo "${cell.id} [$VALUE] [$${cell.name}]"`)
          .join("\n");
        const { stdout, stderr, exitCode } = await $`${{ raw: script }}`;
        expect(stdout.toString()).toBe(
          cells
            .map(cell => `${cell.id} [${cell.result === "!" ? "none" : value(cell.result)}] [${cell.after}]\n`)
            .join(""),
        );
        expect(stderr.toString()).toBe(
          cells
            .filter(cell => cell.result === "!")
            .map(cell => cell.error)
            .join(""),
        );
        expect(exitCode).toBe(0);
      });

      test("in a [[ ]] operand", async () => {
        const script = cells
          .map(cell => `${cell.setup}[[ .${cell.form}. == .${cell.result}. ]] && echo "${cell.id}"`)
          .join("\n");
        const { stdout, stderr } = await $`${{ raw: script }}`;
        expect(stdout.toString()).toBe(
          cells
            .filter(cell => cell.result !== "!")
            .map(cell => `${cell.id}\n`)
            .join(""),
        );
        expect(stderr.toString()).toBe(
          cells
            .filter(cell => cell.result === "!")
            .map(cell => cell.error)
            .join(""),
        );
      });

      // What changes "$NAME" (#44904) must change each of these with it.
      test('a form that expands to nothing in double quotes is what "$NAME" is', async () => {
        const spellings = [
          ...['"${U}"', '"${E}"', '"${9}"', '"${U:-}"', '"${U-}"', '"${E:-}"', '"${E-x}"', '"${9:-}"'],
          ...['"${U:+x}"', '"${U+x}"', '"${E:+x}"', '"${E+}"', '"${E=x}"', '"${E?x}"'],
          ...['"${U:-$U}"', '"${U:-${U}}"', '"${U:-$(true)}"', '"${U:-""}"', '${U:-"$U"}', '${U:-"$(true)"}'],
          ...['"${SHELL_TEST_A:=}"', '"${SHELL_TEST_B=}"', '~"${U:-}"'],
        ];
        const echo = (word: string) => `echo a ${word} b`;
        const bare = (word: string) => (word.startsWith("~") ? '~"$U"' : word.includes("E") ? '"$E"' : '"$U"');
        const run = (script: string) => $`E=; ${{ raw: script }}`.text();
        expect(await run(spellings.map(echo).join("\n"))).toBe(await run(spellings.map(bare).map(echo).join("\n")));
        // A `""` in a word that is not in double quotes is one empty argument.
        expect(await argvOf('a ${U:-""} ${U:-\'\'} "${U:-}""" b')).toEqual(["a", "", "", "", "b"]);
      });

      // Whitespace in the word ends no argument there.
      raw(
        [
          '[[ ${U:-a b} == "a b" ]] && echo 1',
          "[[ ${U:-a b} != ab ]] && echo 2",
          '[[ ${U:-x $(echo a b)} == "x a b" ]] && echo 3',
          "[[ -n ${U:- } ]] && echo 4",
          "touch myfile; [[ -f ${U:-my file} ]] || echo 5",
          '[[ ${S:=a  b} == "a  b" ]] && echo 6',
        ].join("\n"),
      )
        .ensureTempDir()
        .stdout("1\n2\n3\n4\n5\n6\n")
        .runAsTest("a [[ ]] operand is one string");

      raw("echo hi > out_${SHELL_TEST_UNSET:-a}.txt; SET=b; echo hi > out_${SET:+c}.txt")
        .ensureTempDir()
        .fileEquals("out_a.txt", "hi\n")
        .fileEquals("out_c.txt", "hi\n")
        .runAsTest("in a redirect target");
      raw("echo hi > ${U:-a b}")
        .ensureTempDir()
        .exitCode(1)
        .stderr("bun: ambiguous redirect: at `echo`\n")
        .doesNotExist("a")
        .runAsTest("a redirect target of two words is ambiguous");

      test("a positional parameter", async () => {
        const { stdout } = await $`echo ${{ raw: "${0:+zero} ${0:-none} ${9:-none} ${9:+nine}." }}`;
        expect(stdout.toString()).toBe(`zero ${process.argv[0]} none .\n`);
      });

      describe("the word", () => {
        test("unquoted whitespace ends an argument", async () => {
          expect(await argvOf("${U:-a b} ${U:-  a\tb  } pre${U:- a }post ${U:-} x${U:-}y")).toEqual([
            ...["a", "b"],
            ...["a", "b"],
            ...["pre", "a", "post"],
            "xy",
          ]);
          expect(await argvOf("${U:-a\nb}")).toEqual(["a", "b"]);
        });

        test("quotes and escapes keep whitespace", async () => {
          expect(await argvOf(`"\${U:-a  b}" \${U:-'a b' "c d" e\\ f} \${U:-a"b c"d e} \${U:-""} \${U:-''}x`)).toEqual([
            "a  b",
            "a b",
            "c d",
            "e f",
            "ab cd",
            "e",
            "",
            "x",
          ]);
        });

        raw('VALUE=${U:-a  b}; echo "[$VALUE]"; export EXPORTED=${U:- c }; echo "[$EXPORTED]"')
          .stdout("[a  b]\n[ c ]\n")
          .runAsTest("whitespace is text in the value of an assignment");

        test("the value of a variable is one argument", async () => {
          expect(await argvOf("${S:-d} ${S:+$S} ${U:-$S} ${U:=a b} $U", 'S="a b";')).toEqual([
            "a b",
            "a b",
            "a b",
            "a b",
            "a b",
          ]);
        });

        test("a $(...)", async () => {
          expect(
            await argvOf(
              '${U:-$(echo c d)} "${U:-$(echo "c  d")}" ${U:-`echo e`} pre${U:-$(echo q r)}post ${U:- $(echo s) }post',
            ),
          ).toEqual(["c", "d", "c  d", "e", "preq", "rpost", "s", "post"]);
        });

        test("a nested form", async () => {
          expect(await argvOf("${U:-${V:-z w}} ${U:-${V:-${W:-deep}}} ${U:-${S:+no}${V:-yes}} ${U:-${S%x}}")).toEqual([
            "z",
            "w",
            "deep",
            "yes",
            "${S%x}",
          ]);
        });

        raw("S=1; echo ${S:-$(touch unused1.txt)} ${U:+$(touch unused2.txt)} ${U:-$(touch used.txt)}.")
          .ensureTempDir()
          .stdout("1 .\n")
          .doesNotExist("unused1.txt")
          .doesNotExist("unused2.txt")
          .fileEquals("used.txt", "")
          .runAsTest("a $(...) runs only when the word is the result");

        raw('echo ${U:-a;b|c&d>e<f(g)#h} "${U:-;}" ${U:-{a,b}} ${U:-a}b}')
          .ensureTempDir()
          .stdout("a;b|c&d>e<f(g)#h ; {a,b} ab}\n")
          .doesNotExist("e")
          .runAsTest("operators and braces are text");

        raw('echo ${U:-"}"} ${U:-a\\}b} "${U:-a\\}b}" "${U:-"}"}" ${U:-\\$S} ${U:-a\\\nb}')
          .stdout("} a}b a}b } $S ab\n")
          .runAsTest("a quoted or escaped } does not end the form");

        raw('HOME=/home/user USERPROFILE=/home/user && echo ${U:-~/a} a${U:-~} "${U:-~/a}" ${U:-a~}')
          .stdout("/home/user/a a/home/user ~/a a~\n")
          .runAsTest("a tilde starts the word");
        // As in sh, the `~` is `$HOME` only when it is the whole word or a `/` follows it.
        raw('S=1; echo ${U:-~abc} ${U:-~+} ${U:-~$S} ${U:-~$U} ${U:-~""} ${U:-~ b} ${U:=~abc} $U; echo ${V:=~} $V')
          .env({ ...bunEnv, HOME: "/home/user", USERPROFILE: "/home/user" })
          .stdout("~abc ~+ ~1 ~ ~ ~ b ~abc ~abc\n/home/user /home/user\n")
          .runAsTest("a tilde before other text is text");

        // A field ends where the word has whitespace. The `~` of the argument and a `""` go to their own field.
        test("each field of an argument", async () => {
          expect(
            await fieldsOf([
              "~/.cache${HOME:+ force}",
              "~/x${U:- }",
              "~/x${U:- ~/y}",
              '~/a$(echo "b c")',
              '${HOME:+name ""}',
              '${U:-"" b}',
              '${U:-a "" b}',
              '${U:-"" ""}',
              '${U:-"" }',
              '${U:-"" }{a,b}',
              // A `~` before an expansion that gives nothing is no argument.
              "~$U",
              "~${HOME:+ x}",
            ]),
          ).toEqual([
            ["/home/user/.cache", "force"],
            ["/home/user/x"],
            ["/home/user/x", "~/y"],
            ["/home/user/ab", "c"],
            ["name", ""],
            ["", "b"],
            ["a", "", "b"],
            ["", ""],
            [""],
            ["", "a", "", "b"],
            [],
            ["x"],
          ]);
        });

        // The word expands in the same way with a `$(...)` in it.
        test("a $(...) in the word changes no other part of it", async () => {
          using dir = tempDir("shell-word-subst", { "a.txt": "", "src/x.ts": "" });
          const pairs: [string, string, string[]][] = [
            ["pre${U:- a $E}post", "pre${U:- a $(true)}post", ["pre", "a", "post"]],
            ["a${U:-$E b}", "a${U:-$(true) b}", ["a", "b"]],
            ["x${U:-$E a}", "x${U:-$E $(echo a)}", ["x", "a"]],
            ["${U:-a $E}y", "${U:-$(echo a) $E}y", ["a", "y"]],
            ["x=${U:-$E y}", "x=${U:-$(true) y}", ["x=", "y"]],
            ["a${U:-${V:- b}}", "a${U:-${V:- b}$(true)}", ["a", "b"]],
            ["${U:-${V:-b }}c", "${U:-$(true)${V:-b }}c", ["b", "c"]],
            ["${U:-~/bin /opt/bin}", "${U:-~/bin $(echo /opt/bin)}", ["/home/user/bin", "/opt/bin"]],
            ["${U:-~abc}", "${U:-~abc$(echo)}", ["~abc"]],
            ["${U:-~}", "${U:-~}$(true)", ["/home/user"]],
            ["${U:-src/*.ts}", "${U:-$(echo src)/*.ts}", [join("src", "x.ts")]],
            ["${U:-a.*}", "${U:-$(echo a).*}", ["a.txt"]],
            ["${U:-*.txt}$E", "${U:-*.txt$(true)}", ["a.txt"]],
          ];
          const expected = pairs.map(([, , fields]) => fields);
          expect(
            await fieldsOf(
              pairs.map(([plain]) => plain),
              String(dir),
            ),
          ).toEqual(expected);
          expect(
            await fieldsOf(
              pairs.map(([, withSubst]) => withSubst),
              String(dir),
            ),
          ).toEqual(expected);
        });

        raw('echo ${U:-*.txt} "${U:-*.txt}" ${U:-a.*}')
          .ensureTempDir()
          .file("a.txt", "")
          .file("b.txt", "")
          .stdout(stdout =>
            expect(stdout.split(/\s+/).filter(Boolean).sort()).toEqual(["*.txt", "a.txt", "a.txt", "b.txt"]),
          )
          .runAsTest("an unquoted * is a glob");

        raw("S=x; echo ${U:-*.none}; echo ${S:-*.none} ${U:+*.none} ${U:-a }")
          .ensureTempDir()
          .stdout("x a\n")
          .stderr("bun: no matches found: *.none\n")
          .runAsTest("a * is a glob only in the word that is the result");

        test("whitespace at the end of a word adds no empty argument", async () => {
          expect(await argvOf("${U:-a}${U:-b c}d ${U:-a }${U:-} ${U:- } x${U:-b } ${U:-$(echo c) }")).toEqual([
            "ab",
            "cd",
            "a",
            "xb",
            "c",
          ]);
        });

        // As in sh, a `{a,b}` or a `*` expands in each field of an argument.
        test("a brace group in a field that whitespace of a word ends", async () => {
          expect(await argvOf("{a,b}${U:-c }")).toEqual(["ac", "bc"]);
        });
        test("a glob in a field that whitespace of a word ends", async () => {
          expect(await argvIn(["a.txt"], "*.txt${U:- }")).toEqual(["a.txt"]);
        });
        raw("echo *.none${U:-d }; echo *.none${U:- e}")
          .ensureTempDir()
          .stderr("bun: no matches found: *.noned\nbun: no matches found: *.none\n")
          .exitCode(1)
          .runAsTest("a glob with no match in a field that whitespace of a word ends");

        raw('S=é; echo ${S:-ü} ${U:-ü ö} "${U:-ü ö}" é${U:+ü}é')
          .stdout("é ü ö ü ö éé\n")
          .runAsTest("text that is not ASCII");
      });

      describe("= and :=", () => {
        raw('echo ${A:=one} ${A:=two} $A; B=; echo "[${B=no}]" "[${B:=yes}]" $B')
          .stdout("one one one\n[] [yes] yes\n")
          .runAsTest("assign once");
        raw('S=1; true ${A:=$(echo a) b$S ${S:+c}}; echo "$A"')
          .stdout("a b1 c\n")
          .runAsTest("the value is the expanded word");
        raw('(echo ${A:=sub}); echo $(echo ${B:=subst}) "[$A$B]"; echo ${C:=pipe} | cat; echo "[$C]"')
          .stdout("sub\nsubst []\npipe\n[]\n")
          .runAsTest("not outside a subshell, a $(...) or a pipeline");
        raw('true ${A:=v}; echo "[$A]"').stdout("[v]\n").runAsTest("in the argument of a command that ignores it");
        test("a quote or a * in the word is not syntax of the argument", async () => {
          using dir = tempDir("shell-assign-word", { "a.txt": "" });
          const { stdout } = await $`${BUN} -e ${printArgv} ${{ raw: "${A:=\"\"} ${B=''} ${C:=*.txt} x" }}`.cwd(
            String(dir),
          );
          expect(JSON.parse(stdout.toString())).toEqual(["*.txt", "x"]);
        });
        raw("echo ${9:=v}; echo after")
          .stdout("after\n")
          .stderr("bun: $9: cannot assign in this way\n")
          .runAsTest("not to a positional parameter");
      });

      describe("? and :?", () => {
        raw('true "${U:?}" && echo RAN')
          .exitCode(1)
          .stderr("bun: U: parameter null or not set\n")
          .runAsTest("the command does not run and what follows && does not");
        raw("echo ${U?}; E=; echo ${E:?}; echo ${9:?}; echo ${U:?need $E U  here}")
          .exitCode(1)
          .stderr(
            "bun: U: parameter not set\nbun: E: parameter null or not set\nbun: 9: parameter null or not set\nbun: U: need  U  here\n",
          )
          .runAsTest("the message");
        raw('echo "${U:?need  $(echo that) U}"')
          .exitCode(1)
          .stderr("bun: U: need  that U\n")
          .runAsTest("the message from a word in double quotes");
        raw("echo a; echo ${U:?boom}; echo b; echo ${U:?boom} || echo c")
          .stdout("a\nb\nc\n")
          .stderr("bun: U: boom\nbun: U: boom\n")
          .runAsTest("only that command fails");
        raw("VALUE=${U:?one}; VALUE=${U:?two} echo cmd; echo after")
          .stdout("after\n")
          .stderr("bun: U: one\nbun: U: two\n")
          .runAsTest("in the value of an assignment");
        raw("VALUE=${U:?one}").exitCode(1).stderr("bun: U: one\n").runAsTest("an assignment alone has exit code 1");
        raw("VALUE=${U:?two} echo cmd")
          .exitCode(1)
          .stderr("bun: U: two\n")
          .runAsTest("an assignment before a command has exit code 1 and the command does not run");
        raw("VALUE=${U:?one}; VALUE=${U:?two} echo cmd; echo after")
          .quiet()
          .stdout("after\n")
          .stderr("bun: U: one\nbun: U: two\n")
          .runAsTest("in the value of an assignment, with .quiet()");
        raw("A=1 B=${U:?stop} C=2; echo $A-$C; VALUE=${U:?one} || echo or")
          .stdout("1-\nor\n")
          .stderr("bun: U: stop\nbun: U: one\n")
          .runAsTest("the assignments before it are made and the ones after it are not");
        // 16 alternatives in each of 5 groups are 1048576 words, over the limit of 65536.
        raw("VALUE=" + Buffer.alloc(33 * 5, "{a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p}").toString() + "; echo after")
          .stdout("after\n")
          .stderr("bun: too many brace expansions (1048576 > 65536)\n")
          .runAsTest("another error in the value of an assignment is written too");
        raw("echo hi > ${U:?no file}.txt; echo ${U:-$(echo ${U:?inner})} after")
          .ensureTempDir()
          .stdout("after\n")
          .stderr("bun: U: no file\nbun: U: inner\n")
          .doesNotExist(".txt")
          .runAsTest("in a redirect target and in a $(...)");
        raw("echo ${U:-x${U:?nested}} after; echo ${U:-$(echo y)${U:?beside a substitution}} after")
          .exitCode(1)
          .stderr("bun: U: nested\nbun: U: beside a substitution\n")
          .runAsTest("in the word of another form");
        raw("S=1; echo ${S:?no} ${S?no} ${U:-${S:?no}} ${S:+${U:-ok}}")
          .stdout("1 1 1 ok\n")
          .runAsTest("set is the value");
      });

      // sh reads the `A` of the same command. Bun's shell does not, for $A too.
      test("an assignment before a command is not read by a later one, like $NAME", async () => {
        const printB = "console.log(process.env.B)";
        const run = (value: string) => $`A=x ${{ raw: "B=[" + value + "]" }} ${BUN} -e ${printB}`.text();
        expect([await run("$A"), await run("${A}"), await run("${A:-none}")]).toEqual(["[]\n", "[]\n", "[none]\n"]);
      });

      // `$` reads the raw template, so an escaped `${` is text. A `{ raw }` value carries a form.
      test("in a template literal", async () => {
        const { stdout, stderr, exitCode } =
          await $`FOO=bar; echo \${FOO} \${FOO:-d} "\${NONE:?}" ${{ raw: "${FOO:-d} ${NONE:-d}" }}`.quiet();
        expect(stderr.toString()).toBe("");
        expect(stdout.toString()).toBe("${FOO} ${FOO:-d} ${NONE:?} bar d\n");
        expect(exitCode).toBe(0);
      });

      test("reads an environment set with .env()", async () => {
        const words = { raw: "${FOO:-none} ${BAR:-none} ${FOO:+set}" };
        const { stdout, stderr, exitCode } = await $`echo ${words}`.env({ ...bunEnv, FOO: "bar" });
        expect(stderr.toString()).toBe("");
        expect(stdout.toString()).toBe("bar none set\n");
        expect(exitCode).toBe(0);
      });

      // A script with a form that does not end runs with every `${` as text.
      raw("echo ${U:-a} $(echo ${U:-b) c}; echo next")
        .stdout("${U:-a} ${U:-b c}\nnext\n")
        .runAsTest("a form that does not end makes every form text");
      // As text, a guard stops nothing. So a script that has one does not run.
      raw('true "${U:?}" && echo RAN; echo ${V:-z')
        .error("Unclosed parameter expansion")
        .runAsTest("a form that does not end is an error in a script with a ? form");
      test("forms nest to the depth of $(...)", async () => {
        const repeat = (text: string, count: number) => Buffer.alloc(text.length * count, text).toString();
        const nested = (depth: number) => ({ raw: repeat("${A:-", depth) + "x" + repeat("}", depth) });
        expect(await $`echo ${nested(128)}`.text()).toBe("x\n");
        // A form past the limit is text.
        expect(await $`echo ${nested(129)}`.text()).toBe("${A:-x}\n");
        // A form counts as one level of $(...).
        const inSubst = (depth: number) => ({ raw: repeat("$(echo ", depth) + "${A:-x}" + repeat(")", depth) });
        expect(await $`echo ${inSubst(127)}`.text()).toBe("x\n");
        expect(await $`echo ${inSubst(128)}`.text()).toBe("${A:-x}\n");
        // The forms after it are read: a guard still stops its command.
        const guard = { raw: 'true "${SHELL_TEST_UNSET:?}" && echo RAN' };
        const { stdout, stderr, exitCode } = await $`echo ${nested(129)}; ${guard}`.nothrow().quiet();
        expect(stderr.toString()).toBe("bun: SHELL_TEST_UNSET: parameter null or not set\n");
        expect(stdout.toString()).toBe("${A:-x}\n");
        expect(exitCode).toBe(1);
      });
    });
  });

  describe("cd & pwd", () => {
    test("cd", async () => {
      const { stdout } = await $`cd ${temp_dir} && ls`;
      const str = stdout.toString();
      expect(
        str
          .split("\n")
          .filter(s => s.length > 0)
          .sort(),
      ).toEqual([...temp_files, "foo", "lmao.txt"].sort());
    });

    test("cd -", async () => {
      const { stdout } = await $`cd ${temp_dir} && pwd && cd - && pwd`;
      expect(stdout.toString()).toEqual(`${temp_dir}\n${process.cwd().replaceAll("\\", "/")}\n`);
    });

    test("cd with no args goes to $HOME", async () => {
      const { stdout, stderr, exitCode } = await $`pwd && cd && pwd`
        .env({ ...bunEnv, HOME: temp_dir, USERPROFILE: temp_dir })
        .quiet()
        .nothrow();
      expect(stderr.toString()).toBe("");
      expect(stdout.toString()).toBe(`${process.cwd().replaceAll("\\", "/")}\n${temp_dir}\n`);
      expect(exitCode).toBe(0);
    });

    test("cd with no args and HOME unset errors", async () => {
      const env: Record<string, string | undefined> = { ...bunEnv, HOME: "", USERPROFILE: "" };
      delete env.HOME;
      delete env.USERPROFILE;
      const { stderr, exitCode } = await $`cd`.env(env).quiet().nothrow();
      expect(stderr.toString()).toBe("cd: HOME not set\n");
      expect(exitCode).toBe(1);
    });

    // Overflowing the 4096-byte threadlocal join_buf used by changeCwdImpl would
    // corrupt adjacent TLS (ReleaseFast) or trip bounds checks (debug). These must
    // now return ENAMETOOLONG instead. Spawned in a subprocess so a regression
    // crashes the child, not the test runner.
    test("cd rejects path longer than buffer with ENAMETOOLONG", async () => {
      const script = `
        import { $ } from "bun";
        const big = "/" + Buffer.alloc(1 << 20, "a").toString();
        const { stderr, exitCode } = await $\`cd \${big}\`.nothrow().quiet();
        console.log(JSON.stringify({ exitCode, stderr: stderr.toString() }));
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe(JSON.stringify({ exitCode: 1, stderr: "cd: file name too long\n" }));
      expect(exitCode).toBe(0);
    });

    test("cd rejects relative path that would overflow join buffer", async () => {
      // cwd + "/" + rel must exceed join_buf.len (4096) even though rel alone might not;
      // the relative branch normalizes into the same buffer via joinZ with no bounds check.
      // Uses a 1MB relative path so a regression faults rather than silently corrupting TLS.
      const script = `
        import { $ } from "bun";
        const rel = Buffer.alloc(1 << 20, "a/").toString();
        const { stderr, exitCode } = await $\`cd \${rel}\`.nothrow().quiet();
        console.log(JSON.stringify({ exitCode, stderr: stderr.toString() }));
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe(JSON.stringify({ exitCode: 1, stderr: "cd: file name too long\n" }));
      expect(exitCode).toBe(0);
    });

    test(".cwd() rejects path longer than buffer with ENAMETOOLONG", async () => {
      const script = `
        import { $ } from "bun";
        const big = "/" + Buffer.alloc(1 << 20, "a").toString();
        try {
          await $\`echo hi\`.cwd(big);
          console.log("no-throw");
        } catch (e) {
          console.log(e.code ?? e.message);
        }
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("ENAMETOOLONG");
      expect(exitCode).toBe(0);
    });

    test(".cwd() to a missing directory rejects the promise instead of throwing from then()", async () => {
      using dir = tempDir("cwd-missing", {});
      const missing = join(String(dir), "does-not-exist");
      const promise = $`echo hi`.cwd(missing).nothrow();
      // `then()` starts the shell. A setup failure must settle the promise,
      // not throw out of `then()`.
      const settled = promise.then(
        () => "resolved",
        e => e,
      );
      const err = await settled;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("No such file or directory");
    });

    // handleChangeCwdErr's `else` arm previously returned `.failed` without writing
    // to stderr or calling done(), so any errno other than NOTDIR/NOENT/NAMETOOLONG
    // (e.g. EACCES, ELOOP) left the shell promise unresolved forever.
    test.if(isPosix && !isRoot)("cd with EACCES fails with exit code 1 instead of hanging", async () => {
      await using dir = tempDir("cd-eacces", { "placeholder.txt": "" });
      const noaccess = join(dir, "noaccess");
      mkdirSync(noaccess);
      chmodSync(noaccess, 0o000);
      try {
        const { stderr, exitCode } = await $`cd ${noaccess}`.quiet().nothrow();
        expect(stderr.toString()).toBe(`cd: Permission denied: ${noaccess}\n`);
        expect(exitCode).toBe(1);
      } finally {
        chmodSync(noaccess, 0o755);
      }
    });
  });

  test("which", async () => {
    const bogus = "akdfjlsdjflks";
    const { stdout } = await $`which ${BUN} ${bogus}`;
    const bunWhich = Bun.which(BUN);
    expect(stdout.toString()).toEqual(`${bunWhich}\n${bogus} not found\n`);
  });

  describe("rm", () => {
    let temp_dir: string;
    const files = {
      foo: "bar",
      bar: "baz",
      dir: {
        some: "more",
        files: "here",
      },
    };
    beforeAll(() => {
      temp_dir = tempDirWithFiles("temp-rm", files);
    });

    test("error without recursive option", async () => {
      const { stderr } = await $`rm -v ${temp_dir}`;
      expect(stderr.toString()).toEqual(`rm: ${temp_dir}: Is a directory\n`);
    });

    test("recursive", async () => {
      const { stdout } = await $`rm -vrf ${temp_dir}`;
      const str = stdout.toString();
      expect(
        str
          .split("\n")
          .filter(s => s.length !== 0)
          .sort(),
      ).toEqual(
        `${join(temp_dir, "foo")}
${join(temp_dir, "dir", "files")}
${join(temp_dir, "dir", "some")}
${join(temp_dir, "dir")}
${join(temp_dir, "bar")}
${temp_dir}`
          .split("\n")
          .sort(),
      );
    });
  });

  /**
   *
   */
  describe("escaping", () => {
    // Testing characters that need special handling when not quoted or in different contexts
    TestBuilder.command`echo ${"$"}`.stdout("$\n").runAsTest("dollar");
    TestBuilder.command`echo ${">"}`.stdout(">\n").runAsTest("right_arrow");
    TestBuilder.command`echo ${"&"}`.stdout("&\n").runAsTest("ampersand");
    TestBuilder.command`echo ${"|"}`.stdout("|\n").runAsTest("pipe");
    TestBuilder.command`echo ${"="}`.stdout("=\n").runAsTest("equals");
    TestBuilder.command`echo ${";"}`.stdout(";\n").runAsTest("semicolon");
    TestBuilder.command`echo ${"\n"}`.stdout("\n").runAsTest("newline");
    TestBuilder.command`echo ${"{"}`.stdout("{\n").runAsTest("left_brace");
    TestBuilder.command`echo ${"}"}`.stdout("}\n").runAsTest("right_brace");
    TestBuilder.command`echo ${","}`.stdout(",\n").runAsTest("comma");
    TestBuilder.command`echo ${"("}`.stdout("(\n").runAsTest("left_parenthesis");
    TestBuilder.command`echo ${")"}`.stdout(")\n").runAsTest("right_parenthesis");
    TestBuilder.command`echo ${"\\"}`.stdout("\\\n").runAsTest("backslash");
    TestBuilder.command`echo ${" "}`.stdout(" \n").runAsTest("space");
    TestBuilder.command`echo ${"'hello'"}`.stdout("'hello'\n").runAsTest("single_quote");
    TestBuilder.command`echo ${'"hello"'}`.stdout('"hello"\n').runAsTest("double_quote");
    TestBuilder.command`echo ${"`hello`"}`.stdout("`hello`\n").runAsTest("backtick");

    // Testing characters that need to be escaped within double quotes
    TestBuilder.command`echo "${"$"}"`.stdout("$\n").runAsTest("dollar_in_dquotes");
    TestBuilder.command`echo "${"`"}"`.stdout("`\n").runAsTest("backtick_in_dquotes");
    TestBuilder.command`echo "${'"'}"`.stdout('"\n').runAsTest("double_quote_in_dquotes");
    TestBuilder.command`echo "${"\\"}"`.stdout("\\\n").runAsTest("backslash_in_dquotes");

    // Testing characters that need to be escaped within single quotes
    TestBuilder.command`echo '${"$"}'`.stdout("$\n").runAsTest("dollar_in_squotes");
    TestBuilder.command`echo '${'"'}'`.stdout('"\n').runAsTest("double_quote_in_squotes");
    TestBuilder.command`echo '${"`"}'`.stdout("`\n").runAsTest("backtick_in_squotes");
    TestBuilder.command`echo '${"\\\\"}'`.stdout("\\\\\n").runAsTest("backslash_in_squotes");

    // Ensure that backslash escapes within single quotes are treated literally
    TestBuilder.command`echo '${"\\"}'`.stdout("\\\n").runAsTest("literal_backslash_single_quote");
    TestBuilder.command`echo '${"\\\\"}'`.stdout("\\\\\n").runAsTest("double_backslash_single_quote");

    // Edge cases with mixed quotes
    TestBuilder.command`echo "'\${"$"}'"`.stdout("'${$}'\n").runAsTest("mixed_quotes_dollar");
    TestBuilder.command`echo '"${"`"}"'`.stdout('"`"\n').runAsTest("mixed_quotes_backtick");

    // Compound command with special characters
    TestBuilder.command`echo ${"hello; echo world"}`.stdout("hello; echo world\n").runAsTest("compound_command");
    TestBuilder.command`echo ${"hello > world"}`.stdout("hello > world\n").runAsTest("redirect_in_echo");
    TestBuilder.command`echo ${"$(echo nested)"}`.stdout("$(echo nested)\n").runAsTest("nested_command_substitution");

    // Pathological cases involving multiple special characters
    TestBuilder.command`echo ${"complex > command; $(execute)"}`
      .stdout("complex > command; $(execute)\n")
      .runAsTest("complex_mixed_special_chars");
  });
});

describe("deno_task", () => {
  describe("commands", async () => {
    TestBuilder.command`echo 1`.stdout("1\n").runAsTest("echo 1");
    TestBuilder.command`echo 1 2   3`.stdout("1 2 3\n").runAsTest("echo 1 2   3");
    TestBuilder.command`echo "1 2   3"`.stdout("1 2   3\n").runAsTest('echo "1 2   3"');
    TestBuilder.command`echo 1 2\ \ \ 3`.stdout("1 2   3\n").runAsTest("echo 1 2\\ \\ \\ 3");
    TestBuilder.command`echo "1 2\ \ \ 3"`.stdout("1 2\\ \\ \\ 3\n").runAsTest('echo "1 2\\ \\ \\ 3"');
    TestBuilder.command`echo test$(echo 1    2)`.stdout("test1 2\n").runAsTest("echo test$(echo 1    2)");
    TestBuilder.command`echo test$(echo "1    2")`.stdout("test1 2\n").runAsTest('echo test$(echo "1    2")');
    TestBuilder.command`echo "test$(echo "1    2")"`.stdout("test1    2\n").runAsTest('echo "test$(echo "1    2")"');
    TestBuilder.command`echo test$(echo "1 2 3")`.stdout("test1 2 3\n").runAsTest('echo test$(echo "1 2 3")');
    TestBuilder.command`VAR=1 BUN_TEST_VAR=1 ${BUN} -e 'console.log(process.env.VAR)' && echo $VAR`
      .stdout("1\n\n")
      .runAsTest("shell var in command");
    TestBuilder.command`VAR=1 VAR2=2 BUN_TEST_VAR=1 ${BUN} -e 'console.log(process.env.VAR + process.env.VAR2)'`
      .stdout("12\n")
      .runAsTest("shell var in command 2");
    TestBuilder.command`EMPTY= BUN_TEST_VAR=1 ${BUN} -e ${"console.log(`EMPTY: ${process.env.EMPTY}`)"}`
      .stdout("EMPTY: \n")
      .runAsTest("empty shell var");
    TestBuilder.command`"echo" "1"`.stdout("1\n").runAsTest("echo 1 quoted");
    TestBuilder.command`echo test-dashes`.stdout("test-dashes\n").runAsTest("echo test-dashes");
    TestBuilder.command`echo 'a/b'/c`.stdout("a/b/c\n").runAsTest("echo 'a/b'/c");
    TestBuilder.command`echo 'a/b'ctest\"te  st\"'asdf'`
      .stdout('a/bctest"te st"asdf\n')
      .runAsTest("echoing a bunch of escapes and quotations");
    TestBuilder.command`echo --test=\"2\" --test='2' test\"TEST\" TEST'test'TEST 'test''test' test'test'\"test\" \"test\"\"test\"'test'`
      .stdout(`--test="2" --test=2 test"TEST" TESTtestTEST testtest testtest"test" "test""test"test\n`)
      .runAsTest("echoing a bunch of escapes and quotations 2");
  });

  describe("boolean logic", async () => {
    TestBuilder.command`echo 1 && echo 2 || echo 3`.stdout("1\n2\n").runAsTest("echo 1 && echo 2 || echo 3");
    TestBuilder.command`echo 1 || echo 2 && echo 3`.stdout("1\n3\n").runAsTest("echo 1 || echo 2 && echo 3");

    TestBuilder.command`echo 1 || (echo 2 && echo 3)`.stdout("1\n").runAsTest("or with subshell");
    TestBuilder.command`false || false || (echo 2 && false) || echo 3`.stdout("2\n3\n").runAsTest("or with subshell 2");
    TestBuilder.command`echo 1 || (echo 2 && echo 3)`.stdout("1\n").runAsTest("conditional with subshell");
    TestBuilder.command`false || false || (echo 2 && false) || echo 3`
      .stdout("2\n3\n")
      .runAsTest("conditional with subshell2");
  });

  describe("command substitution", async () => {
    TestBuilder.command`echo $(echo 1)`.stdout("1\n").runAsTest("nested echo cmd subst");
    TestBuilder.command`echo $(echo 1 && echo 2)`.stdout("1 2\n").runAsTest("nested echo cmd subst with conditional");
    // TODO Sleep tests

    describe("drops NUL bytes from the output", () => {
      TestBuilder.command`echo "$(echo -e 'a\0b\0c')" $(echo -e 'a\0b c\0d')`
        .stdout("abc ab cd\n")
        .runAsTest("passed to echo");

      TestBuilder.command`${BUN} run ./code.ts x $(echo -e '\0') y "$(echo -e '\0')" z`
        .ensureTempDir()
        .file("code.ts", `console.log(JSON.stringify(process.argv.slice(2)))`)
        .stdout(out => expect(JSON.parse(out)).toEqual(["x", "y", "", "z"]))
        .runAsTest("skips an unquoted NUL and passes a quoted NUL as an empty argument");

      TestBuilder.command`${BUN} exec ${`echo hi > "$(echo -e 'f\\0zz')"; touch t1zzz; [[ -f $(echo -e 't1\\0zzz') ]] && echo yes || echo no`}`
        .ensureTempDir()
        .stdout("yes\n")
        .fileEquals("fzz", "hi\n")
        .doesNotExist("f")
        .runAsTest("used as a redirect target or in a file test");
    });
  });

  describe("shell variables", async () => {
    TestBuilder.command`echo $VAR && VAR=1 && echo $VAR && ${BUN} -e ${"console.log(process.env.VAR)"}`
      .stdout("\n1\nundefined\n")
      .runAsTest("shell var");

    TestBuilder.command`VAR=1 && echo $VAR$VAR`.stdout("11\n").runAsTest("shell var 2");

    TestBuilder.command`VAR=1 && echo Test$VAR && echo $(echo "Test: $VAR") ; echo CommandSub$($VAR) ; echo $ ; echo \$VAR`
      .stdout("Test1\nTest: 1\nCommandSub\n$\n$VAR\n")
      .stderr("bun: command not found: 1\n")
      .runAsTest("shell var 3");

    // Assignment values are not field split (POSIX 2.9.1), so the command
    // substitution output keeps its interior whitespace.
    TestBuilder.command`VAR=$(echo a && echo b) && echo "$VAR"`
      .stdout("a\nb\n")
      .runAsTest("assignment keeps command substitution newlines");
  });

  describe("env variables", async () => {
    TestBuilder.command`echo $VAR && export VAR=1 && echo $VAR && BUN_TEST_VAR=1 ${BUN} -e 'console.log(process.env.VAR)'`
      .stdout("\n1\n1\n")
      .runAsTest("exported vars");

    TestBuilder.command`export VAR=1 VAR2=testing VAR3="test this out" && echo $VAR $VAR2 $VAR3`
      .stdout("1 testing test this out\n")
      .runAsTest("exported vars 2");

    // `export` is a declaration utility: a `NAME=value` operand expands like
    // an assignment, with no field splitting of the substitution output.
    TestBuilder.command`export NAME=$(echo "hello world") && echo "NAME=[$NAME] world=[$world]"`
      .stdout("NAME=[hello world] world=[]\n")
      .runAsTest("export does not field split command substitution");

    TestBuilder.command`export A=$(echo one two) B=$(echo three four) && echo "$A,$B"`
      .stdout("one two,three four\n")
      .runAsTest("export does not field split multiple assignment operands");

    // A word that is not a literal `NAME=` assignment keeps the normal
    // field splitting, matching bash.
    TestBuilder.command`export $(echo "SPLIT=hello world") && echo "SPLIT=[$SPLIT]"`
      .stdout("SPLIT=[hello]\n")
      .runAsTest("export splits a non-assignment word");
  });

  describe("pipeline", async () => {
    TestBuilder.command`echo 1 | BUN_TEST_VAR=1 ${BUN} -e 'process.stdin.pipe(process.stdout)'`
      .stdout("1\n")
      .runAsTest("basic pipe");

    TestBuilder.command`echo 1 | echo 2 && echo 3`.stdout("2\n3\n").runAsTest("pipe in conditional");

    TestBuilder.command`echo $(sleep 0.1 && echo 2 & echo 1) | BUN_DEBUG_QUIET_LOGS=1 BUN_TEST_VAR=1 ${BUN} -e 'await process.stdin.pipe(process.stdout)'`
      .stdout("1 2\n")
      .todo("& not supported")
      .runAsTest("complicated pipeline");

    TestBuilder.command`echo 2 | echo 1 | BUN_TEST_VAR=1 ${BUN} -e 'process.stdin.pipe(process.stdout)'`
      .stdout("1\n")
      .runAsTest("multi pipe");

    TestBuilder.command`BUN_TEST_VAR=1 ${BUN} -e 'console.log(1); console.error(2);' | BUN_TEST_VAR=1 ${BUN} -e 'process.stdin.pipe(process.stdout)'`
      .stdout("1\n")
      .stderr("2\n")
      .runAsTest("piping subprocesses");

    TestBuilder.command`BUN_TEST_VAR=1 ${BUN} -e 'console.log(1); console.error(2);' |& BUN_TEST_VAR=1 ${BUN} -e 'process.stdin.pipe(process.stdout)'`
      // .stdout("1\n2\n")
      .error("Piping stdout and stderr (`|&`) is not supported yet. Please file an issue on GitHub.")
      .runAsTest("|&");

    // await TestBuilder.command`BUN_TEST_VAR=1 ${BUN} -e 'console.log(1); console.error(2);' | BUN_TEST_VAR=1 ${BUN} -e 'setTimeout(async () => { await Deno.stdin.readable.pipeTo(Deno.stderr.writable) }, 10)' |& BUN_TEST_VAR=1 ${BUN} -e 'await Deno.stdin.readable.pipeTo(Deno.stderr.writable)'`
    //   .stderr("2\n1\n")
    //   .run();

    TestBuilder.command`echo 1 |& BUN_TEST_VAR=1 ${BUN} -e 'process.stdin.pipe(process.stdout)'`
      // .stdout("1\n")
      .error("Piping stdout and stderr (`|&`) is not supported yet. Please file an issue on GitHub.")
      .runAsTest("|& 2");

    TestBuilder.command`echo 1 | BUN_DEBUG_QUIET_LOGS=1 BUN_TEST_VAR=1 ${BUN} -e 'process.stdin.pipe(process.stdout)' > output.txt`
      .fileEquals("output.txt", "1\n")
      .runAsTest("pipe with redirect to file");

    TestBuilder.command`echo 1 | BUN_TEST_VAR=1 ${BUN} -e 'process.stdin.pipe(process.stderr)' 2> output.txt`
      .fileEquals("output.txt", "1\n")
      .runAsTest("pipe with redirect stderr to file");

    if (isPosix) {
      TestBuilder.command`ls . | echo hi`.exitCode(0).stdout("hi\n").runAsTest("broken pipe builtin");
      TestBuilder.command`grep hi src/js_parser/parser.rs | echo hi`
        .exitCode(0)
        .stdout("hi\n")
        .stderr("")
        .runAsTest("broken pipe subproc");
    }

    TestBuilder.command`${BUN} -e 'process.exit(1)' | ${BUN} -e 'console.log("hi")'`
      .exitCode(0)
      .stdout("hi\n")
      .runAsTest("last exit code");

    TestBuilder.command`ls sldkfjlskdjflksdjflksjdf | ${BUN} -e 'console.log("hi")'`
      .exitCode(0)
      .stdout("hi\n")
      .stderr("ls: sldkfjlskdjflksdjflksjdf: No such file or directory\n")
      .runAsTest("last exit code");

    TestBuilder.command`ksldfjsdflsdfjskdfjlskdjflksdf | ${BUN} -e 'console.log("hi")'`
      .exitCode(0)
      .stdout("hi\n")
      .stderr("bun: command not found: ksldfjsdflsdfjskdfjlskdjflksdf\n")
      .runAsTest("last exit code 2");

    TestBuilder.command`echo hi | ${BUN} -e 'process.exit(69)'`.exitCode(69).stdout("").runAsTest("last exit code 3");

    describe("pipeline stack behavior", () => {
      // Test deep pipeline chains to stress the stack implementation
      TestBuilder.command`echo 1 | echo 2 | echo 3 | echo 4 | echo 5 | BUN_TEST_VAR=1 ${BUN} -e 'process.stdin.pipe(process.stdout)'`
        .stdout("5\n")
        .runAsTest("deep pipeline chain");

      // Test very deep chains that could overflow a recursion-based implementation
      TestBuilder.command`echo start | echo 1 | echo 2 | echo 3 | echo 4 | echo 5 | echo 6 | echo 7 | echo 8 | echo 9 | echo 10 | echo 11 | echo 12 | echo 13 | echo 14 | echo 15 | BUN_TEST_VAR=1 ${BUN} -e 'process.stdin.pipe(process.stdout)'`
        .stdout("15\n")
        .runAsTest("very deep pipeline chain");

      // Test nested pipelines in subshells
      TestBuilder.command`echo outer | (echo inner1 | echo inner2) | BUN_TEST_VAR=1 ${BUN} -e 'process.stdin.pipe(process.stdout)'`
        .stdout("inner2\n")
        .runAsTest("nested pipeline in subshell");

      // Test nested pipelines with command substitution
      TestBuilder.command`echo $(echo nested | echo pipe) | BUN_TEST_VAR=1 ${BUN} -e 'process.stdin.pipe(process.stdout)'`
        .stdout("pipe\n")
        .runAsTest("nested pipeline in command substitution");

      // Test multiple nested pipelines
      TestBuilder.command`(echo a | echo b) | (echo c | echo d) | BUN_TEST_VAR=1 ${BUN} -e 'process.stdin.pipe(process.stdout)'`
        .stdout("d\n")
        .runAsTest("multiple nested pipelines");

      // Test pipeline with conditional that contains another pipeline
      TestBuilder.command`echo test | (echo inner | echo nested && echo after) | BUN_TEST_VAR=1 ${BUN} -e 'process.stdin.pipe(process.stdout)'`
        .stdout("nested\nafter\n")
        .runAsTest("pipeline with conditional containing pipeline");

      // Test deeply nested subshells with pipelines
      TestBuilder.command`echo start | (echo l1 | (echo l2 | (echo l3 | echo final))) | BUN_TEST_VAR=1 ${BUN} -e 'process.stdin.pipe(process.stdout)'`
        .stdout("final\n")
        .runAsTest("deeply nested subshells with pipelines");

      // Test pipeline stack unwinding with early termination
      TestBuilder.command`echo 1 | echo 2 | echo 3 | false | echo 4 | BUN_TEST_VAR=1 ${BUN} -e 'process.stdin.pipe(process.stdout)'`
        .stdout("4\n")
        .runAsTest("pipeline with failing command");

      // Test interleaved pipelines and conditionals
      TestBuilder.command`echo a | echo b && echo c | echo d | BUN_TEST_VAR=1 ${BUN} -e 'process.stdin.pipe(process.stdout)'`
        .stdout("b\nd\n")
        .runAsTest("interleaved pipelines and conditionals");

      // Test pipeline with background process (when supported)
      TestBuilder.command`echo foreground | echo pipe && (echo background &) | BUN_TEST_VAR=1 ${BUN} -e 'process.stdin.pipe(process.stdout)'`
        .stdout("pipe\n")
        .todo("background processes not fully supported")
        .runAsTest("pipeline with background process");

      // Test rapid pipeline creation and destruction
      TestBuilder.command`echo 1 | echo 2; echo 3 | echo 4; echo 5 | echo 6 | BUN_TEST_VAR=1 ${BUN} -e 'process.stdin.pipe(process.stdout)'`
        .stdout("2\n4\n6\n")
        .runAsTest("rapid pipeline creation");

      // Test pipeline stack with error propagation
      TestBuilder.command`echo start | nonexistent_command | echo after || echo fallback`
        .stdout("after\n")
        .stderr("bun: command not found: nonexistent_command\n")
        .runAsTest("pipeline error propagation");

      // Test nested pipeline with mixed success/failure
      TestBuilder.command`(echo success | echo works) | (nonexistent | echo backup) || echo final_fallback`
        .stdout("backup\n")
        .stderr(s => s.includes("command not found"))
        .runAsTest("nested pipeline mixed success failure");

      TestBuilder.command`echo 0 | echo 1 | echo 2 | echo 3 | echo 4 | echo 5 | echo 6 | echo 7 | echo 8 | echo 9 | echo 10 | echo 11 | echo 12 | echo 13 | echo 14 | echo 15 | echo 16 | echo 17 | echo 18 | echo 19 | echo 20 | echo 21 | echo 22 | echo 23 | echo 24 | echo 25 | echo 26 | echo 27 | echo 28 | echo 29 | echo 30 | echo 31 | echo 32 | echo 33 | echo 34 | echo 35 | echo 36 | echo 37 | echo 38 | echo 39 | echo 40 | echo 41 | echo 42 | echo 43 | echo 44 | echo 45 | echo 46 | echo 47 | echo 48 | echo 49 | BUN_TEST_VAR=1 ${BUN} -e 'process.stdin.pipe(process.stdout)'`
        .stdout("49\n")
        .runAsTest("long pipeline builtin");

      TestBuilder.command`echo 0 | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | cat | BUN_TEST_VAR=1 ${BUN} -e 'process.stdin.pipe(process.stdout)'`
        .stdout("0\n")
        .runAsTest("long pipeline");

      // Test pipeline stack consistency with complex nesting
      TestBuilder.command`echo outer | (echo inner1 | echo inner2 | (echo deep1 | echo deep2) | echo inner3) | echo final | BUN_TEST_VAR=1 ${BUN} -e 'process.stdin.pipe(process.stdout)'`
        .stdout("final\n")
        .runAsTest("complex nested pipeline consistency");

      // Test pipeline interruption and resumption
      TestBuilder.command`echo start | (echo pause; echo resume) | echo end | BUN_TEST_VAR=1 ${BUN} -e 'process.stdin.pipe(process.stdout)'`
        .stdout("end\n")
        .runAsTest("pipeline interruption resumption");

      // Test extremely deep nested pipeline - this would cause stack overflow with recursion
      TestBuilder.command`echo level0 | (echo level1 | (echo level2 | (echo level3 | (echo level4 | (echo level5 | (echo level6 | (echo level7 | (echo level8 | (echo level9 | (echo level10 | (echo level11 | (echo level12 | (echo level13 | (echo level14 | (echo level15 | (echo level16 | (echo level17 | (echo level18 | (echo level19 | echo deep_final))))))))))))))))))) | BUN_TEST_VAR=1 ${BUN} -e 'process.stdin.pipe(process.stdout)'`
        .stdout("deep_final\n")
        .runAsTest("extremely deep nested pipeline");

      // Test pathological case: deep nesting + long chains
      TestBuilder.command`echo start | (echo n1 | echo n2 | echo n3 | (echo deep1 | echo deep2 | echo deep3 | (echo deeper1 | echo deeper2 | echo deeper3 | (echo deepest1 | echo deepest2 | echo deepest_final)))) | BUN_TEST_VAR=1 ${BUN} -e 'process.stdin.pipe(process.stdout)'`
        .stdout("deepest_final\n")
        .runAsTest("pathological deep nesting with long chains");
    });
  });

  describe("redirects", async function igodf() {
    TestBuilder.command`echo 5 6 7 > test.txt`.fileEquals("test.txt", "5 6 7\n").runAsTest("basic redirect");

    TestBuilder.command`echo 1 2 3 && echo 1 > test.txt`
      .stdout("1 2 3\n")
      .fileEquals("test.txt", "1\n")
      .runAsTest("basic redirect with &&");

    // subdir
    TestBuilder.command`mkdir subdir && cd subdir && echo 1 2 3 > test.txt`
      .fileEquals(`subdir/test.txt`, "1 2 3\n")
      .runAsTest("redirect to file");

    // absolute path
    TestBuilder.command`echo 1 2 3 > "$PWD/test.txt"`
      .fileEquals("test.txt", "1 2 3\n")
      .runAsTest("redirection path gets expanded");

    // stdout
    TestBuilder.command`BUN_TEST_VAR=1 ${BUN} -e 'console.log(1); console.error(5)' 1> test.txt`
      .stderr("5\n")
      .fileEquals("test.txt", "1\n")
      .runAsTest("redirect stdout of subproccess");

    // stderr
    TestBuilder.command`BUN_TEST_VAR=1 ${BUN} -e 'console.log(1); console.error(5)' 2> test.txt`
      .stdout("1\n")
      .fileEquals("test.txt", "5\n")
      .runAsTest("redirect stderr of subprocess");

    // invalid fd
    // await TestBuilder.command`echo 2 3> test.txt`
    //   .ensureTempDir()
    //   .stderr("only redirecting to stdout (1) and stderr (2) is supported\n")
    //   .exitCode(1)
    //   .run();

    // /dev/null
    TestBuilder.command`BUN_TEST_VAR=1 ${BUN} -e 'console.log(1); console.error(5)' 2> /dev/null`
      .stdout("1\n")
      .runAsTest("/dev/null");

    // appending
    TestBuilder.command`echo 1 > test.txt && echo 2 >> test.txt`
      .fileEquals("test.txt", "1\n2\n")
      .runAsTest("appending");

    // &> and &>> redirect
    await TestBuilder.command`BUN_TEST_VAR=1 ${BUN} -e 'console.log(1); setTimeout(() => console.error(23), 10)' &> file.txt && BUN_TEST_VAR=1 ${BUN} -e 'console.log(456); setTimeout(() => console.error(789), 10)' &>> file.txt`
      .fileEquals("file.txt", "1\n23\n456\n789\n")
      .runAsTest("&> and &>> redirect");

    // multiple arguments after re-direct
    // await TestBuilder.command`export TwoArgs=testing\\ this && echo 1 > $TwoArgs`
    //   .stderr(
    //     'redirect path must be 1 argument, but found 2 (testing this). Did you mean to quote it (ex. "testing this")?\n',
    //   )
    //   .exitCode(1)
    //   .run();

    // zero arguments after re-direct
    TestBuilder.command`echo 1 > $EMPTY`
      .stderr("bun: ambiguous redirect: at `echo`\n")
      .exitCode(1)
      .runAsTest("zero arguments after re-direct");

    describe("multiple arguments after re-direct (ambiguous)", () => {
      // bash: `*.txt: ambiguous redirect`, exit 1, tree unchanged.
      // Previously bun concatenated the matched names into one bogus path.
      TestBuilder.command`echo hi > *.txt; ls`
        .ensureTempDir()
        .file("a1.txt", "A\n")
        .file("b2.txt", "B\n")
        .stderr("bun: ambiguous redirect: at `echo`\n")
        .stdout(out => expect(sortedShellOutput(out)).toEqual(["a1.txt", "b2.txt"]))
        .fileEquals("a1.txt", "A\n")
        .fileEquals("b2.txt", "B\n")
        .runAsTest("> glob matching multiple files");

      TestBuilder.command`echo hi >> *.txt; ls`
        .ensureTempDir()
        .file("a1.txt", "A\n")
        .file("b2.txt", "B\n")
        .stderr("bun: ambiguous redirect: at `echo`\n")
        .stdout(out => expect(sortedShellOutput(out)).toEqual(["a1.txt", "b2.txt"]))
        .fileEquals("a1.txt", "A\n")
        .fileEquals("b2.txt", "B\n")
        .runAsTest(">> glob matching multiple files");

      TestBuilder.command`cat < *.txt`
        .ensureTempDir()
        .file("a1.txt", "A\n")
        .file("b2.txt", "B\n")
        .stderr(s => {
          expect(s).toContain("ambiguous redirect");
          expect(s).not.toContain("a1.txt");
          expect(s).not.toContain("b2.txt");
        })
        .exitCode(1)
        .runAsTest("< glob matching multiple files");

      TestBuilder.command`echo hi > {a,b}.txt; ls`
        .ensureTempDir()
        .stderr("bun: ambiguous redirect: at `echo`\n")
        .stdout("")
        .runAsTest("> brace expansion producing multiple words");

      TestBuilder.command`BUN_TEST_VAR=1 ${BUN} -e 'console.log("hi")' > *.txt; ls`
        .ensureTempDir()
        .file("a1.txt", "A\n")
        .file("b2.txt", "B\n")
        .stderr(s => expect(s).toContain("ambiguous redirect"))
        .stdout(out => expect(sortedShellOutput(out)).toEqual(["a1.txt", "b2.txt"]))
        .fileEquals("a1.txt", "A\n")
        .fileEquals("b2.txt", "B\n")
        .runAsTest("> glob matching multiple files (subprocess)");

      // Control: a glob that matches exactly one file redirects to it.
      TestBuilder.command`echo hi > a1*`
        .ensureTempDir()
        .file("a1.txt", "A\n")
        .file("b2.txt", "B\n")
        .exitCode(0)
        .fileEquals("a1.txt", "hi\n")
        .fileEquals("b2.txt", "B\n")
        .runAsTest("> glob matching a single file writes to it");
    });

    TestBuilder.command`echo foo bar > file.txt; cat < file.txt`
      .ensureTempDir()
      .stdout("foo bar\n")
      .runAsTest("redirect input");

    TestBuilder.command`BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e ${"console.log('Stdout'); console.error('Stderr')"} 2>&1`
      .stdout("Stdout\nStderr\n")
      .runAsTest("redirect stderr to stdout");

    TestBuilder.command`BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e ${"console.log('Stdout'); console.error('Stderr')"} 1>&2`
      .stderr("Stdout\nStderr\n")
      .runAsTest("redirect stdout to stderr");

    TestBuilder.command`BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e ${"console.log('Stdout'); console.error('Stderr')"} 2>&1`
      .stdout("Stdout\nStderr\n")
      .quiet()
      .runAsTest("redirect stderr to stdout quiet");

    TestBuilder.command`BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e ${"console.log('Stdout'); console.error('Stderr')"} 1>&2`
      .stderr("Stdout\nStderr\n")
      .quiet()
      .runAsTest("redirect stdout to stderr quiet");

    TestBuilder.command`echo hi > /dev/null`.quiet().runAsTest("redirect /dev/null");

    TestBuilder.command`BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e ${"console.log('Hello friends')"} > /dev/null`
      .quiet()
      .runAsTest("subproc redirect /dev/null");

    const code = /* ts */ `
      import { $ } from 'bun'

      await $\`echo Bunception!\`
      `;

    TestBuilder.command`BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e ${code} > /dev/null`
      .quiet()
      .runAsTest("bunception redirect /dev/null");
  });

  describe("pwd", async () => {
    TestBuilder.command`pwd && cd sub_dir && pwd && cd ../ && pwd`
      .directory("sub_dir")
      .file("file.txt", "test")
      // $TEMP_DIR gets replaced with the actual temp dir by the test runner
      .stdout(`$TEMP_DIR\n${join("$TEMP_DIR", "sub_dir")}\n$TEMP_DIR\n`)
      .runAsTest("pwd");
  });

  test("change env", async () => {
    {
      const { stdout } = await $`echo $FOO`.env({ ...bunEnv, FOO: "bar" });
      expect(stdout.toString()).toEqual("bar\n");
    }

    {
      const { stdout } = await $`BUN_TEST_VAR=1 ${BUN} -e 'console.log(JSON.stringify(process.env))'`.env({
        ...bunEnv,
        FOO: "bar",
      });
      expect(JSON.parse(stdout.toString())).toEqual({
        ...bunEnv,
        BUN_TEST_VAR: "1",
        FOO: "bar",
      });
    }

    {
      const { stdout } = await $`BUN_TEST_VAR=1 ${BUN} -e 'console.log(JSON.stringify(process.env))'`.env({
        ...bunEnv,
        FOO: "bar",
      });
      expect(JSON.parse(stdout.toString())).toEqual({
        ...bunEnv,
        BUN_TEST_VAR: "1",
        FOO: "bar",
      });
    }
  });

  // https://github.com/oven-sh/bun/issues/11305
  test.todoIf(isWindows)("stacktrace", async () => {
    // const folder = TestBuilder.tmpdir();
    const code = /* ts */ `import { $ } from 'bun'

    $.throws(true)

    async function someFunction() {
      await $\`somecommandthatdoesnotexist\`
    }

    await someFunction()
    `;

    const [_, lineNr] = code
      .split("\n")
      .map((l, i) => [l, i + 1] as const)
      .find(([line, _]) => line.includes("somecommandthatdoesnotexist"))!;

    if (lineNr === undefined) throw new Error("uh oh");

    await TestBuilder.command`BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e ${code} 2>&1`
      .exitCode(1)
      .stdout(s => expect(s).toInclude(`[eval]:${lineNr}`))
      .run();
  });

  test("big_data", async () => {
    const writerCode = /* ts */ `

    const writer = Bun.stdout.writer();
    const buf = new Uint8Array(128 * 1024).fill('a'.charCodeAt(0))
    for (let i = 0; i < 10; i++) {
      writer.write(buf);
      await writer.flush();
    }
    `;

    const tmpdir = TestBuilder.tmpdir();
    // I think writing 1mb of 'a's to the terminal breaks CI so redirect to a FD instead
    const { stdout, stderr, exitCode } = await $`${BUN} -e ${writerCode} > ${tmpdir}/output.txt`.env(bunEnv);

    expect(stderr.length).toEqual(0);
    expect(stdout.length).toEqual(0);
    expect(exitCode).toEqual(0);

    const s = await stat(`${tmpdir}/output.txt`);
    expect(s.size).toEqual(10 * 128 * 1024);
  });

  // https://github.com/oven-sh/bun/issues/9458
  test("input", async () => {
    const inputCode = /* ts */ `
    const downArrow = '\\x1b[B';
    const enterKey = '\\x0D';
    await Bun.sleep(100)
    const writer = Bun.stdout.writer();
    writer.write(downArrow)
    await Bun.sleep(100)
    writer.write(enterKey)
    writer.flush()
    `;

    const code = /* ts */ `
    import { expect } from 'bun:test'
    const expected = [
      '\\x1b[B',
      '\\x0D'
    ].join("")
    let i = 0
    let buf = ""
    const writer = Bun.stdout.writer();
    process.stdin.on("data", async chunk => {
      const input = chunk.toString();
      buf += input;
      if (buf === expected) {
        writer.write(buf);
        await writer.flush();
      }
    });
    `;

    const { stdout, stderr, exitCode } =
      await Bun.$`BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e ${inputCode} | BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e ${code}`;

    expect(exitCode).toBe(0);
    expect(stderr.length).toBe(0);
    expect(stdout.toString()).toEqual("\x1b[B\x0D");
  });
});

describe("if_clause", () => {
  TestBuilder.command /* sh */ `
# The name of the package we're interested in
package_name=react

filename=package.json

if [[ -f $filename ]]; then
  echo The file $filename exists and is a regular file.
  echo Checking for $package_name in dependencies...

  # Attempt to extract the package version from dependencies
  dep_version=$(jq -r ".dependencies[\"$package_name\"]" $filename)

  # If not found in dependencies, try devDependencies
  if [[ -z $dep_version ]] || [[ $dep_version == null ]]; then
    dep_version=$(jq -r ".devDependencies[\"$package_name\"]" $filename)
  fi

  # Check if we got a non-empty, non-null version string
  if [[ -n $dep_version ]] && [[ $dep_version != null ]]; then
    echo The package $package_name is listed as a dependency with version: $dep_version.
  else
    echo The package $package_name is not listed as a dependency.
  fi
else
  echo The file $filename does not exist or is not a regular file.
fi
`
    .file(
      "package.json",
      `{
  "private": true,
  "name": "bun",
  "dependencies": {
    "@vscode/debugadapter": "1.61.0",
    "esbuild": "0.17.15",
    "eslint": "8.20.0",
    "eslint-config-prettier": "8.5.0",
    "mitata": "0.1.3",
    "peechy": "0.4.34",
    "prettier": "3.2.5",
    "react": "next",
    "react-dom": "next",
    "source-map-js": "1.0.2",
    "typescript": "5.0.2"
  },
  "devDependencies": {
  },
  "scripts": {
  }
}
`,
    )
    .stdout(
      "The file package.json exists and is a regular file.\nChecking for react in dependencies...\nThe package react is listed as a dependency with version: next.\n",
    );

  TestBuilder.command`
  if
    echo cond;
  then
    echo then;
  elif
    echo elif;
  then
    echo elif then;
  else
    echo else;
  fi`
    .stdout("cond\nthen\n")
    .runAsTest("basic");

  TestBuilder.command`
  if
    echo cond
  then
    echo then
  elif
    echo elif
  then
    echo elif then
  else
    echo else
  fi`
    .stdout("cond\nthen\n")
    .runAsTest("basic without semicolon");

  TestBuilder.command`
  if
    lkfjslkdjfsldf
  then
    echo shouldnt see this
  else
    echo okay here
  fi`
    .stdout("okay here\n")
    .stderr("bun: command not found: lkfjslkdjfsldf\n")
    .runAsTest("else basic");

  TestBuilder.command`
  if
    lkfjslkdjfsldf
  then
    echo shouldnt see this
  elif
    sdfkjsldf
  then
    echo shouldnt see this either
  else
    echo okay here
  fi`
    .stdout("okay here\n")
    .stderr("bun: command not found: lkfjslkdjfsldf\nbun: command not found: sdfkjsldf\n")
    .runAsTest("else");

  TestBuilder.command`
  if
    echo hi
  then
    echo hey
  else
    echo uh oh
  fi | cat
  `
    .stdout("hi\nhey\n")
    .runAsTest("in pipeline");

  TestBuilder.command`if echo hi; then echo lmao; fi && echo nice`
    .stdout("hi\nlmao\nnice\n")
    .runAsTest("no else, cond true");

  TestBuilder.command`if BUNISBAD; then echo not true; fi && echo bun is good`
    .stdout("bun is good\n")
    .stderr("bun: command not found: BUNISBAD\n")
    .runAsTest("no else, cond false");

  TestBuilder.command`if [[ -f package.json ]]
  then
    a
    b
  else
    c
  fi`
    .exitCode(1)
    .file("package.json", "lol")
    .stderr("bun: command not found: a\nbun: command not found: b\n")
    .runAsTest("multi statement then");

  TestBuilder.command`if
    [[ -f package.json ]]
    [[ -f lkdfjlskdf ]]
  then
    echo yeah...
    echo nope!
  else
    echo okay
    echo makes sense!
  fi`
    .file("package.json", "lol")
    .stdout("okay\nmakes sense!\n")
    .runAsTest("multi statement in all branches");

  ["if", "else", "elif", "then", "fi"].map(tok => {
    TestBuilder.command`"${{ raw: tok }}"`
      .stderr(`bun: command not found: ${tok}\n`)
      .exitCode(1)
      .runAsTest(`quoted ${tok} doesn't break`);

    TestBuilder.command`echo ${{ raw: "lksdfjklsdjf" + tok }}`
      .stdout(`lksdfjklsdjf${tok}\n`)
      .runAsTest(`${tok} in script does not break parsing 1`);

    TestBuilder.command`echo ${{ raw: "hi " + tok }}`
      .stdout(`hi ${tok}\n`)
      .runAsTest(`${tok} in script does not break parsing 2`);

    TestBuilder.command`echo ${{ raw: tok + " hi" }}`
      .stdout(`${tok} hi\n`)
      .runAsTest(`${tok} in script does not break parsing 3`);
  });

  TestBuilder.command`echo fif hi`.stdout("fif hi\n").runAsTest("parsing edge case");

  // Ported from https://github.com/posix-shell-tests/posix-shell-tests/
  describe("ported from posix shell tests", () => {
    // test_oE 'execution path of if, true'
    TestBuilder.command`if echo foo; then echo bar; fi`.stdout("foo\nbar\n").runAsTest("execution path of if, true");

    // test_oE 'execution path of if, false'
    TestBuilder.command`if ! echo foo; then echo bar; fi`
      .stdout("foo\n")
      .todo("! not supported")
      .runAsTest("execution path of if, false");

    // test_oE 'execution path of if-else, true'
    TestBuilder.command`if echo foo; then echo bar; else echo baz; fi`
      .stdout("foo\nbar\n")
      .runAsTest("execution path of if-else, true");

    // test_oE 'execution path of if-else, false'
    TestBuilder.command`if ! echo foo; then echo bar; else echo baz; fi`
      .stdout("foo\nbaz\n")
      .todo("! not supported")
      .runAsTest("execution path of if-else, false");

    // test_oE 'execution path of if-elif, true'
    TestBuilder.command`if echo 1; then echo 2; elif echo 3; then echo 4; fi`
      .stdout("1\n2\n")
      .runAsTest("execution path of if-elif, true");

    // test_oE 'execution path of if-elif, false-true'
    TestBuilder.command`if ! echo 1; then echo 2; elif echo 3; then echo 4; fi`
      .stdout("1\n3\n4\n")
      .todo("! not supported")
      .runAsTest("execution path of if-elif, false-true");

    // test_oE 'execution path of if-elif, false-false'
    TestBuilder.command`if ! echo 1; then echo 2; elif ! echo 3; then echo 4; fi`
      .stdout("1\n3\n")
      .todo("! not supported")
      .runAsTest("execution path of if-elif, false-false");

    // test_oE 'execution path of if-elif-else, true'
    TestBuilder.command`if echo 1; then echo 2; elif echo 3; then echo 4; else echo 5; fi`
      .stdout("1\n2\n")
      .runAsTest("execution path of if-elif-else, true");

    // test_oE 'execution path of if-elif-else, false-true'
    TestBuilder.command`if ! echo 1; then echo 2; elif echo 3; then echo 4; else echo 5; fi`
      .stdout("1\n3\n4\n")
      .todo("! not supported")
      .runAsTest("execution path of if-elif-else, false-true");

    // test_oE 'execution path of if-elif-else, false-false'
    TestBuilder.command`if ! echo 1; then echo 2; elif ! echo 3; then echo 4; else echo 5; fi`
      .stdout("1\n3\n5\n")
      .todo("! not supported")
      .runAsTest("execution path of if-elif-else, false-false");

    // test_oE 'execution path of if-elif-elif, true'
    TestBuilder.command`if echo 1; then echo 2; elif echo 3; then echo 4; elif echo 5; then echo 6; fi`
      .stdout("1\n2\n")
      .runAsTest("execution path of if-elif-elif, true");

    // test_oE 'execution path of if-elif-elif, false-true'
    TestBuilder.command`if ! echo 1; then echo 2; elif echo 3; then echo 4; elif echo 5; then echo 6; fi`
      .stdout("1\n3\n4\n")
      .todo("! not supported")
      .runAsTest("execution path of if-elif-elif, false-true");

    // test_oE 'execution path of if-elif-elif, false-false-true'
    TestBuilder.command`if ! echo 1; then echo 2; elif ! echo 3; then echo 4; elif echo 5; then echo 6; fi`
      .stdout("1\n3\n5\n6\n")
      .todo("! not supported")
      .runAsTest("execution path of if-elif-elif, false-false-true");

    // test_oE 'execution path of if-elif-elif, false-false-false'
    TestBuilder.command`if ! echo 1; then echo 2; elif ! echo 3; then echo 4; elif ! echo 5; then echo 6; fi`
      .stdout("1\n3\n5\n")
      .todo("! not supported")
      .runAsTest("execution path of if-elif-elif, false-false-false");

    // test_oE 'execution path of if-elif-elif-else, true'
    TestBuilder.command`if echo 1; then echo 2; elif echo 3; then echo 4; elif echo 5; then echo 6; else echo 7; fi`
      .stdout("1\n2\n")
      .runAsTest("execution path of if-elif-elif-else, true");

    // test_oE 'execution path of if-elif-elif-else, false-true'
    TestBuilder.command`if ! echo 1; then echo 2; elif echo 3; then echo 4; elif echo 5; then echo 6; else echo 7; fi`
      .stdout("1\n3\n4\n")
      .todo("! not supported")
      .runAsTest("execution path of if-elif-elif-else, false-true");

    // test_oE 'execution path of if-elif-elif-else, false-false-true'
    TestBuilder.command`if ! echo 1; then echo 2; elif ! echo 3; then echo 4; elif echo 5; then echo 6; else echo 7; fi`
      .stdout("1\n3\n5\n6\n")
      .todo("! not supported")
      .runAsTest("execution path of if-elif-elif-else, false-false-true");

    // test_oE 'execution path of if-elif-elif-else, false-false-false'
    TestBuilder.command`if ! echo 1; then echo 2; elif ! echo 3; then echo 4; elif ! echo 5; then echo 6; else echo 7; fi`
      .stdout("1\n3\n5\n7\n")
      .todo("! not supported")
      .runAsTest("execution path of if-elif-elif-else, false-false-false");

    const exit = (code: number): { raw: string } => ({
      raw:
        process.platform !== "win32"
          ? `bash -c 'exit $1' -- ${code}`
          : `BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e 'process.exit(${code})'`,
    });

    // test_x -e 0 'exit status of if, true-true'
    TestBuilder.command`if ${exit(0)}; then ${exit(0)}; fi`.exitCode(0).runAsTest("exit status of if, true-true");
    // test_x -e 1 'exit status of if, true-false'
    TestBuilder.command`if ${exit(0)}; then ${exit(1)}; fi`.exitCode(1).runAsTest("exit status of if, true-false");

    // test_x -e 0 'exit status of if, false'
    TestBuilder.command`if ${exit(1)}; then ${exit(2)}; fi`.exitCode(0).runAsTest("exit status of if, false");

    // test_x -e 0 'exit status of if-else, true-true'
    TestBuilder.command`if ${exit(0)}; then ${exit(0)}; else ${exit(1)}; fi`
      .exitCode(0)
      .runAsTest("exit status of if-else, true-true");

    // test_x -e 1 'exit status of if-else, true-false'
    TestBuilder.command`if ${exit(0)}; then ${exit(1)}; else ${exit(2)}; fi`
      .exitCode(1)
      .runAsTest("exit status of if-else, true-false");

    // test_x -e 0 'exit status of if-else, false-true'
    TestBuilder.command`if ${exit(1)}; then ${exit(2)}; else ${exit(0)}; fi`
      .exitCode(0)
      .runAsTest("exit status of if-else, false-true");

    // test_x -e 2 'exit status of if-else, false-false'
    TestBuilder.command`if ${exit(1)}; then ${exit(0)}; else ${exit(2)}; fi`
      .exitCode(2)
      .runAsTest("exit status of if-else, false-false");

    // test_x -e 0 'exit status of if-elif, true-true'
    TestBuilder.command`if ${exit(0)}; then ${exit(0)}; elif ${exit(1)}; then ${exit(2)}; fi`
      .exitCode(0)
      .runAsTest("exit status of if-elif, true-true");

    // test_x -e 1 'exit status of if-elif, true-false'
    TestBuilder.command`if ${exit(0)}; then ${exit(1)}; elif ${exit(2)}; then ${exit(3)}; fi`
      .exitCode(1)
      .runAsTest("exit status of if-elif, true-false");

    // test_x -e 0 'exit status of if-elif, false-true-true'
    TestBuilder.command`if ${exit(1)}; then ${exit(2)}; elif ${exit(0)}; then ${exit(0)}; fi`
      .exitCode(0)
      .runAsTest("exit status of if-elif, false-true-true");

    // test_x -e 3 'exit status of if-elif, false-true-false'
    TestBuilder.command`if ${exit(1)}; then ${exit(2)}; elif ${exit(0)}; then ${exit(3)}; fi`
      .exitCode(3)
      .runAsTest("exit status of if-elif, false-true-false");

    // test_x -e 0 'exit status of if-elif-elif-else, true-true'
    TestBuilder.command`if ${exit(0)}; then ${exit(0)}; elif ${exit(1)}; then ${exit(2)}; elif ${exit(3)}; then ${exit(4)}; else ${exit(5)}; fi`
      .exitCode(0)
      .runAsTest("exit status of if-elif-elif-else, true-true");

    // test_x -e 11 'exit status of if-elif-elif-else, true-false'
    TestBuilder.command`if ${exit(0)}; then ${exit(11)}; elif ${exit(1)}; then ${exit(2)}; elif ${exit(3)}; then ${exit(4)}; else ${exit(5)}; fi`
      .exitCode(11)
      .runAsTest("exit status of if-elif-elif-else, true-false");

    // test_x -e 0 'exit status of if-elif-elif-else, false-true-true'
    TestBuilder.command`if ${exit(1)}; then ${exit(2)}; elif ${exit(0)}; then ${exit(0)}; elif ${exit(3)}; then ${exit(4)}; else ${exit(5)}; fi`
      .exitCode(0)
      .runAsTest("exit status of if-elif-elif-else, false-true-true");

    // test_x -e 13 'exit status of if-elif-elif-else, false-true-false'
    TestBuilder.command`if ${exit(1)}; then ${exit(2)}; elif ${exit(0)}; then ${exit(13)}; elif ${exit(3)}; then ${exit(4)}; else ${exit(5)}; fi`
      .exitCode(13)
      .runAsTest("exit status of if-elif-elif-else, false-true-false");

    // test_x -e 0 'exit status of if-elif-elif-else, false-false-true-true'
    TestBuilder.command`if ${exit(1)}; then ${exit(2)}; elif ${exit(3)}; then ${exit(4)}; elif ${exit(0)}; then ${exit(0)}; else ${exit(5)}; fi`
      .exitCode(0)
      .runAsTest("exit status of if-elif-elif-else, false-false-true-true");

    // test_x -e 5 'exit status of if-elif-elif-else, false-false-true-false'
    TestBuilder.command`if ${exit(1)}; then ${exit(2)}; elif ${exit(3)}; then ${exit(4)}; elif ${exit(0)}; then ${exit(5)}; else ${exit(6)}; fi`
      .exitCode(5)
      .runAsTest("exit status of if-elif-elif-else, false-false-true-false");

    // test_x -e 0 'exit status of if-elif-elif-else, false-false-false-true'
    TestBuilder.command`if ${exit(1)}; then ${exit(2)}; elif ${exit(3)}; then ${exit(4)}; elif ${exit(5)}; then ${exit(6)}; else ${exit(0)}; fi`
      .exitCode(0)
      .runAsTest("exit status of if-elif-elif-else, false-false-false-true");

    // test_x -e 7 'exit status of if-elif-elif-else, false-false-false-false'
    TestBuilder.command`if ${exit(1)}; then ${exit(2)}; elif ${exit(3)}; then ${exit(4)}; elif ${exit(5)}; then ${exit(6)}; else ${exit(7)}; fi`
      .exitCode(7)
      .runAsTest("exit status of if-elif-elif-else, false-false-false-false");

    // test_oE 'linebreak after if'
    TestBuilder.command`if
echo foo;then echo bar;fi`
      .stdout("foo\nbar\n")
      .runAsTest("linebreak after if");

    // test_oE 'linebreak before then (after if)'
    TestBuilder.command`if echo foo
then echo bar;fi`
      .stdout("foo\nbar\n")
      .runAsTest("linebreak before then (after if)");

    // test_oE 'linebreak after then (after if)'
    TestBuilder.command`if echo foo;then
echo bar;fi`
      .stdout("foo\nbar\n")
      .runAsTest("linebreak after then (after if)");

    // test_oE 'linebreak before fi (after then)'
    TestBuilder.command`if echo foo;then echo bar
fi`
      .stdout("foo\nbar\n")
      .runAsTest("linebreak before fi (after then)");

    // test_oE 'linebreak before elif'
    TestBuilder.command`if ! echo foo;then echo bar
elif echo baz;then echo qux;fi`
      .stdout("foo\nbaz\nqux\n")
      .todo("! not supported")
      .runAsTest("linebreak before elif");

    // test_oE 'linebreak after elif'
    TestBuilder.command`if ! echo foo;then echo bar;elif
echo baz;then echo qux;fi`
      .stdout("foo\nbaz\nqux\n")
      .todo("! not supported")
      .runAsTest("linebreak after elif");

    // test_oE 'linebreak before then (after elif)'
    TestBuilder.command`if ! echo foo;then echo bar;elif echo baz
then echo qux;fi`
      .stdout("foo\nbaz\nqux\n")
      .todo("! not supported")
      .runAsTest("linebreak before then (after elif)");

    // test_oE 'linebreak after then (after elif)'
    TestBuilder.command`if ! echo foo;then echo bar;elif echo baz;then
echo qux;fi`
      .stdout("foo\nbaz\nqux\n")
      .todo("! not supported")
      .runAsTest("linebreak after then (after elif)");

    // test_oE 'linebreak before else'
    TestBuilder.command`if ! echo foo;then echo bar
else echo baz;fi`
      .stdout("foo\nbaz\n")
      .todo("! not supported")
      .runAsTest("linebreak before else");

    // test_oE 'linebreak after else'
    TestBuilder.command`if ! echo foo;then echo bar;else
echo baz;fi`
      .stdout("foo\nbaz\n")
      .todo("! not supported")
      .runAsTest("linebreak after else");

    // test_oE 'linebreak before fi (after else)'
    TestBuilder.command`if ! echo foo;then echo bar;else echo baz
fi`
      .stdout("foo\nbaz\n")
      .todo("! not supported")
      .runAsTest("linebreak before fi (after else)");

    // test_oE 'command ending with asynchronous command (after if)'
    TestBuilder.command`if echo foo&then wait;fi`
      .stdout("foo\n")
      .todo("wait not implemented")
      .runAsTest("command ending with asynchronous command (after if)");

    // test_oE 'command ending with asynchronous command (after then)'
    TestBuilder.command`if echo foo;then echo bar&fi;wait`
      .stdout("foo\nbar\n")
      .todo("wait not implementeeed")
      .runAsTest("command ending with asynchronous command (after then)");

    // test_oE 'command ending with asynchronous command (after elif)'
    TestBuilder.command`if ! echo foo;then echo bar;elif echo baz&then wait;fi`
      .stdout("foo\nbaz\n")
      .todo("! not supported")
      .runAsTest("command ending with asynchronous command (after elif)");

    // test_oE 'command ending with asynchronous command (after else)'
    TestBuilder.command`if ! echo foo;then echo bar;elif ! echo baz;then echo qux;else echo quux;fi;wait`
      .stdout("foo\nbaz\nquux\n")
      .todo("! not supported")
      .runAsTest("command ending with asynchronous command (after else)");

    // test_oE 'more than one inner command'
    TestBuilder.command`if echo 1; echo 2
echo 3; ! echo 4; then echo x1; echo x2
echo x3; echo x4; elif echo 5; echo 6
echo 7; echo 8; then echo 9; echo 10
echo 11; echo 12; else echo x5; echo x6
echo x7; echo x8; fi`
      .stdout("1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n")
      .todo("! not supported")
      .runAsTest("more than one inner command");

    // test_oE 'nest between if and then'
    TestBuilder.command`if { echo foo; } then echo bar; fi`
      .stdout("foo\nbar\n")
      .todo("grouping with { and } not supported yet")
      .runAsTest("nest between if and then");

    // test_oE 'nest between then and fi'
    TestBuilder.command`if echo foo; then { echo bar; } fi`
      .stdout("foo\nbar\n")
      .todo("grouping with { and } not supported yet")
      .runAsTest("nest between then and fi");

    // test_oE 'nest between then and elif'
    TestBuilder.command`if echo foo; then { echo bar; } elif echo baz; then echo qux; fi`
      .stdout("foo\nbar\n")
      .todo("grouping with { and } not supported yet")
      .runAsTest("nest between then and elif");

    // test_oE 'nest between elif and then'
    TestBuilder.command`if echo foo; then echo bar; elif { echo baz; } then echo qux; fi`
      .stdout("foo\nbar\n")
      .todo("grouping with { and } not supported yet")
      .runAsTest("nest between elif and then");

    // test_oE 'nest between then and else'
    TestBuilder.command`if ! echo foo; then { echo bar; } else echo baz; fi`
      .stdout("foo\nbaz\n")
      .todo("! not supported")
      .runAsTest("nest between then and else");

    // test_oE 'nest between then and else'
    TestBuilder.command`if ! echo foo; then echo bar; else { echo baz; } fi`
      .stdout("foo\nbaz\n")
      .todo("! not supported")
      .runAsTest("nest between then and else");

    // test_oE 'redirection on if'
    TestBuilder.command`if echo foo
then echo bar
else echo baz
fi >redir_out
cat redir_out`
      .stdout("foo\nbar\n")
      .todo("redirecting if-else not supported yet")
      .runAsTest("redirection on if");
  });
});

describe("condexprs", () => {
  TestBuilder.command`[[ -f package.json ]] && echo yes!`.file("package.json", "hi").stdout("yes!\n").runAsTest("-f");
  TestBuilder.command`[[ -f mumbo.jumbo ]] && echo yes!`.exitCode(1).runAsTest("-f non-existent");
  TestBuilder.command`[[ -f mydir ]] && echo yes!`.directory("mydir").exitCode(1).runAsTest("-f directory");
  TestBuilder.command`[[ -f /dev/null ]] && echo yes!`.exitCode(1).runAsTest("-f character device");

  TestBuilder.command`[[ -d mydir ]] && echo yes!`.directory("mydir").stdout("yes!\n").runAsTest("-d");
  TestBuilder.command`[[ -d mumbo.jumbo ]] && echo yes!`.exitCode(1).runAsTest("-d non-existent");
  TestBuilder.command`[[ -d package.json ]] && echo yes!`
    .file("package.json", "hi")
    .exitCode(1)
    .runAsTest("-d regular file");

  TestBuilder.command`[[ -c /dev/null ]] && echo yes!`.stdout("yes!\n").runAsTest("-c");
  TestBuilder.command`[[ -c lol ]] && echo yes!`.exitCode(1).file("lol", "lol").runAsTest("-c not character device");
  TestBuilder.command`[[ -c mumbo.jumbo ]] && echo yes!`.exitCode(1).runAsTest("-c non-existent");

  TestBuilder.command`FOO=""; [[ -z $FOO ]] && echo yes!`.stdout("yes!\n").runAsTest("-z");
  TestBuilder.command`[[ -z "skldjfldsf" ]] && echo yes!`.exitCode(1).runAsTest("-z fail");

  TestBuilder.command`FOO="lkjdflskdjf"; [[ -n $FOO ]] && echo yes!`.stdout("yes!\n").runAsTest("-n");
  TestBuilder.command`FOO="" [[ -n $FOO ]] && echo yes!`.exitCode(1).runAsTest("-n fail");

  TestBuilder.command`[[ -n hey ]] | echo hi | cat`.stdout("hi\n").runAsTest("precedence: pipeline");

  TestBuilder.command`[[ foo == foo ]] && echo yes!`.stdout("yes!\n").runAsTest("==");
  TestBuilder.command`[[ foo == lol ]] && echo yes!`.exitCode(1).runAsTest("== fail");
  TestBuilder.command`[[ foo != foo ]] && echo yes!`.exitCode(1).runAsTest("!= fail");
  TestBuilder.command`[[ lmao != foo ]] && echo yes!`.stdout("yes!\n").runAsTest("!=");

  TestBuilder.command`LOL=; [[ $LOl == $LOL ]] && echo yes!`.stdout("yes!\n").runAsTest("== empty");
  TestBuilder.command`LOL=; [[ $LOl != $LOL ]] && echo yes!`.exitCode(1).runAsTest("!= empty");

  describe.todo("ported from GNU bash", () => {
    TestBuilder.command`
    [[ foo > bar && $PWD -ef . ]]
    `
      .exitCode(0)
      .runAsTest("this one is straight out of the ksh88 book");

    TestBuilder.command`
    [[ x ]]
    `
      .exitCode(0)
      .runAsTest("[[ x ]] is equivalent to [[ -n x ]]");

    TestBuilder.command`[[ ! x ]]`.exitCode(1).runAsTest("# [[ ! x ]] is equivalent to [[ ! -n x ]]");

    // tests.ts

    TestBuilder.command`[[ ! x || x ]]`
      .exitCode(0)
      .runAsTest("! binds tighter than test/[ -- it binds to a term, not an expression");

    TestBuilder.command`
[[ ! 1 -eq 1 ]]; echo $?
[[ ! ! 1 -eq 1 ]]; echo $?
`
      .stdout("1")
      .stdout("0")
      .runAsTest("! toggles on and off rather than just setting an 'invert result' flag");

    TestBuilder.command`
[[ ! ! ! 1 -eq 1 ]]; echo $?
[[ ! ! ! ! 1 -eq 1 ]]; echo $?
`
      .stdout("1")
      .stdout("0")
      .runAsTest("! toggles on and off rather than just setting an 'invert result' flag");

    TestBuilder.command`[[ a ]]`.exitCode(0).runAsTest("parenthesized terms didn't work right until post-2.04");
    TestBuilder.command`[[ (a) ]]`.exitCode(0).runAsTest("parenthesized terms didn't work right until post-2.04");
    TestBuilder.command`[[ -n a ]]`.exitCode(0).runAsTest("parenthesized terms didn't work right until post-2.04");
    TestBuilder.command`[[ (-n a) ]]`.exitCode(0).runAsTest("parenthesized terms didn't work right until post-2.04");

    TestBuilder.command`[[ -n $UNSET ]]`.exitCode(1).runAsTest("unset variables don't need to be quoted");
    TestBuilder.command`[[ -z $UNSET ]]`.exitCode(0).runAsTest("unset variables don't need to be quoted");

    TestBuilder.command`[[ $TDIR == /usr/homes/* ]]`
      .exitCode(0)
      .runAsTest("the ==/= and != operators do pattern matching");
    TestBuilder.command`[[ $TDIR == /usr/homes/\\* ]]`
      .exitCode(1)
      .runAsTest("...but you can quote any part of the pattern to have it matched as a string");
    TestBuilder.command`[[ $TDIR == '/usr/homes/*' ]]`
      .exitCode(1)
      .runAsTest("...but you can quote any part of the pattern to have it matched as a string");

    TestBuilder.command`[[ -n $UNSET && $UNSET == foo ]]`
      .exitCode(1)
      .runAsTest("if the first part of && fails, the second is not executed");
    TestBuilder.command`[[ -z $UNSET && $UNSET == foo ]]`
      .exitCode(1)
      .runAsTest("if the first part of && fails, the second is not executed");

    TestBuilder.command`[[ -z $UNSET || -d $PWD ]]`
      .exitCode(0)
      .runAsTest("if the first part of || succeeds, the second is not executed");

    // TestBuilder.command`[[ -n $TDIR || $HOME -ef ${H*} ]]`.exitCode(0).runAsTest("if the rhs were executed, it would be an error");
    // TestBuilder.command`[[ -n $TDIR && -z $UNSET || $HOME -ef ${H*} ]]`.exitCode(0).runAsTest("if the rhs were executed, it would be an error");

    TestBuilder.command`[[ -n $TDIR && -n $UNSET || $TDIR -ef . ]]`
      .exitCode(0)
      .runAsTest("&& has a higher parsing precedence than ||");
    TestBuilder.command`[[ -n $TDIR || -n $UNSET && $PWD -ef xyz ]]`
      .exitCode(1)
      .runAsTest("...but expressions in parentheses may be used to override precedence rules");
    TestBuilder.command`[[ ( -n $TDIR || -n $UNSET ) && $PWD -ef xyz ]]`
      .exitCode(1)
      .runAsTest("...but expressions in parentheses may be used to override precedence rules");

    TestBuilder.command`
unset IVAR A
[[ 7 -gt $IVAR ]]
`
      .exitCode(0)
      .runAsTest(
        "some arithmetic tests for completeness -- see what happens with missing operands, bad expressions, makes sure arguments are evaluated as arithmetic expressions, etc.",
      );

    TestBuilder.command`
unset IVAR A
[[ $IVAR -gt 7 ]]
`
      .exitCode(1)
      .runAsTest(
        "some arithmetic tests for completeness -- see what happens with missing operands, bad expressions, makes sure arguments are evaluated as arithmetic expressions, etc.",
      );

    TestBuilder.command`
IVAR=4
[[ $IVAR -gt 7 ]]
`
      .exitCode(1)
      .runAsTest(
        "some arithmetic tests for completeness -- see what happens with missing operands, bad expressions, makes sure arguments are evaluated as arithmetic expressions, etc.",
      );

    TestBuilder.command`[[ 7 -eq 4+3 ]]`
      .exitCode(0)
      .runAsTest(
        "some arithmetic tests for completeness -- see what happens with missing operands, bad expressions, makes sure arguments are evaluated as arithmetic expressions, etc.",
      );

    TestBuilder.command`[[ 7 -eq 4+ ]]`
      .exitCode(1)
      .stdout('./cond.tests: line 122: [[: 4+: syntax error: operand expected (error token is "+")')
      .runAsTest(
        "some arithmetic tests for completeness -- see what happens with missing operands, bad expressions, makes sure arguments are evaluated as arithmetic expressions, etc.",
      );

    TestBuilder.command`
IVAR=4+3
[[ $IVAR -eq 7 ]]
`
      .exitCode(0)
      .runAsTest(
        "some arithmetic tests for completeness -- see what happens with missing operands, bad expressions, makes sure arguments are evaluated as arithmetic expressions, etc.",
      );

    TestBuilder.command`
A=7
[[ $IVAR -eq A ]]
`
      .exitCode(0)
      .runAsTest(
        "some arithmetic tests for completeness -- see what happens with missing operands, bad expressions, makes sure arguments are evaluated as arithmetic expressions, etc.",
      );

    TestBuilder.command`[[ "$IVAR" -eq "7" ]]`
      .exitCode(0)
      .runAsTest(
        "some arithmetic tests for completeness -- see what happens with missing operands, bad expressions, makes sure arguments are evaluated as arithmetic expressions, etc.",
      );

    TestBuilder.command`
A=7
[[ "$IVAR" -eq "A" ]]
`
      .exitCode(0)
      .runAsTest(
        "some arithmetic tests for completeness -- see what happens with missing operands, bad expressions, makes sure arguments are evaluated as arithmetic expressions, etc.",
      );

    TestBuilder.command`
unset IVAR A
[[ $filename == *.c ]]
`
      .exitCode(1)
      .runAsTest("more pattern matching tests");

    TestBuilder.command`
filename=patmatch.c
[[ $filename == *.c ]]
`
      .exitCode(0)
      .runAsTest("more pattern matching tests");

    TestBuilder.command`
shopt -s extglob
arg=-7
[[ $arg == -+([0-9]) ]]
`
      .exitCode(0)
      .runAsTest("the extended globbing features may be used when matching patterns");

    TestBuilder.command`
shopt -s extglob
arg=-H
[[ $arg == -+([0-9]) ]]
`
      .exitCode(1)
      .runAsTest("the extended globbing features may be used when matching patterns");

    TestBuilder.command`
shopt -s extglob
arg=+4
[[ $arg == ++([0-9]) ]]
`
      .exitCode(0)
      .runAsTest("the extended globbing features may be used when matching patterns");

    TestBuilder.command`
STR=file.c
PAT=
if [[ $STR = $PAT ]]; then
        echo oops
fi
`.runAsTest("make sure the null string is never matched if the string is not null");

    TestBuilder.command`
STR=
PAT=
if [[ $STR = $PAT ]]; then
        echo ok
fi
`
      .stdout("ok")
      .runAsTest("but that if the string is null, a null pattern is matched correctly");

    // TestBuilder.command`
    // [[ jbig2dec-0.9-i586-001.tgz =~ ([^-]+)-([^-]+)-([^-]+)-0*([1-9][0-9]*)\.tgz ]]
    // echo ${BASH_REMATCH[1]}
    // `
    //   .stdout("jbig2dec")
    //   .runAsTest("test the regular expression conditional operator");

    // TestBuilder.command`
    // [[ jbig2dec-0.9-i586-001.tgz =~ \\([^-]+\\)-\\([^-]+\\)-\\([^-]+\\)-0*\\([1-9][0-9]*\\)\\.tgz ]]
    // echo ${BASH_REMATCH[1]}
    // `
    //   .runAsTest("this shouldn't echo anything");

    // TestBuilder.command`
    // LDD_BASH="       linux-gate.so.1 =>  (0xffffe000)
    //        libreadline.so.5 => /lib/libreadline.so.5 (0xb7f91000)
    //        libhistory.so.5 => /lib/libhistory.so.5 (0xb7f8a000)
    //        libncurses.so.5 => /lib/libncurses.so.5 (0xb7f55000)
    //        libdl.so.2 => /lib/libdl.so.2 (0xb7f51000)
    //        libc.so.6 => /lib/libc.so.6 (0xb7e34000)
    //        /lib/ld-linux.so.2 (0xb7fd0000)"
    // [[ "$LDD_BASH" =~ "libc" ]] && echo "found 1"
    // echo ${BASH_REMATCH[@]}
    // `
    //   .stdout("found 1")
    //   .stdout("libc")
    //   .runAsTest("test the regular expression conditional operator");

    // TestBuilder.command`
    // LDD_BASH="       linux-gate.so.1 =>  (0xffffe000)
    //        libreadline.so.5 => /lib/libreadline.so.5 (0xb7f91000)
    //        libhistory.so.5 => /lib/libhistory.so.5 (0xb7f8a000)
    //        libncurses.so.5 => /lib/libncurses.so.5 (0xb7f55000)
    //        libdl.so.2 => /lib/libdl.so.2 (0xb7f51000)
    //        libc.so.6 => /lib/libc.so.6 (0xb7e34000)
    //        /lib/ld-linux.so.2 (0xb7fd0000)"
    // [[ "$LDD_BASH" =~ libc ]] && echo "found 2"
    // echo ${BASH_REMATCH[@]}
    // `
    //   .stdout("found 2")
    //   .stdout("libc")
    //   .runAsTest("test the regular expression conditional operator");

    TestBuilder.command`
if [[ "123abc" == *?(a)bc ]]; then echo ok 42; else echo bad 42; fi
if [[ "123abc" == *?(a)bc ]]; then echo ok 43; else echo bad 43; fi
`
      .stdout("ok 42")
      .stdout("ok 43")
      .runAsTest("bug in all versions up to and including bash-2.05b");

    // TestBuilder.command`
    // match() { [[ $ 1 == $2 ]]; }
    // match $'? *x\1y\177z' $'??\\*\\x\\\1\\y\\\177\\z' || echo bad 44

    // foo=""
    // [[ bar == *"${foo,,}"* ]] && echo ok 1
    // [[ bar == *${foo,,}* ]] && echo ok 2

    // shopt -s extquote
    // bs='\\'
    // del=$'\177'
    // [[ bar == *$bs"$del"* ]] || echo ok 3
    // [[ "" == "$foo" ]] && echo ok 4
    // [[ "$del" == "${foo,,}" ]] || echo ok 5

    // # allow reserved words after a conditional command just because
    // if [[ str ]] then [[ str ]] fi
    // `
    //   .stdout("ok 1")
    //   .stdout("ok 2")
    //   .stdout("ok 3")
    //   .stdout("ok 4")
    //   .stdout("ok 5")
    //   .runAsTest("various tests");
  });
});

describe("subshell", () => {
  const sharppkgjson = /* json */ `{
    "name": "sharp-test",
    "module": "index.ts",
    "type": "module",
    "dependencies": {
      "sharp": "0.33.3"
    }
  }`;

  TestBuilder.command /* sh */ `
  mkdir sharp-test
  cd sharp-test
  echo ${sharppkgjson} > package.json
  ${BUN} i
  `
    .ensureTempDir()
    .stdout(out => expect(out).toInclude("+ sharp@0.33.3"))
    .stderr(() => {})
    .exitCode(0)
    .env(bunEnv)
    .runAsTest("sharp");

  TestBuilder.command /* sh */ `( ( ( ( echo HI! ) ) ) )`.stdout("HI!\n").runAsTest("multiple levels");
  TestBuilder.command /* sh */ `(
    echo HELLO! ;
    echo HELLO AGAIN!
    )`
    .stdout("HELLO!\nHELLO AGAIN!\n")
    .runAsTest("multiline");
  TestBuilder.command /* sh */ `(exit 42)`.exitCode(42).runAsTest("exit code");
  TestBuilder.command /* sh */ `(exit 42); echo hi`.exitCode(0).stdout("hi\n").runAsTest("exit code 2");
  TestBuilder.command /* sh */ `
  VAR1=VALUE1
  VAR2=VALUE2
  VAR3=VALUE3
  (
    echo $VAR1 $VAR2 $VAR3
    VAR1='you cant'
    VAR2='see me'
    VAR3='my time is now'
    echo $VAR1 $VAR2 $VAR3
  )
  echo $VAR1 $VAR2 $VAR3
  `
    .stdout("VALUE1 VALUE2 VALUE3\nyou cant see me my time is now\nVALUE1 VALUE2 VALUE3\n")
    .runAsTest("copy of environment");

  TestBuilder.command /* sh */ `
  mkdir foo
  (
    echo $PWD
    cd foo
    echo $PWD
  )
  echo $PWD
  `
    .ensureTempDir()
    .stdout(`$TEMP_DIR\n$TEMP_DIR${sep}foo\n$TEMP_DIR\n`)
    .runAsTest("does not change cwd");

  TestBuilder.command`
  BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e ${"console.log(process.env.FOO)"}

  (
    export FOO=bar
    BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e ${"console.log(process.env.FOO)"}
  )


  BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e ${"console.log(process.env.FOO)"}
  `
    .stdout("undefined\nbar\nundefined\n")
    .runAsTest("does not modify export env of parent");

  TestBuilder.command`\(echo hi \)`.stderr("bun: command not found: (echo\n").exitCode(1).runAsTest("escaped subshell");
  TestBuilder.command`echo \\\(hi\\\)`.stdout("\\(hi\\)\n").runAsTest("escaped subshell 2");

  TestBuilder.command /* sh */ `
  mkdir dir
  (
    cd dir
    pwd | cat | cat
  )
  pwd
  `
    .ensureTempDir()
    .stdout(`$TEMP_DIR${sep}dir\n$TEMP_DIR\n`)
    .runAsTest("pipeline in subshell");

  TestBuilder.command /* sh */ `
  mkdir dir
  (pwd) | cat
  (cd dir; pwd) | cat
  pwd
  `
    .ensureTempDir()
    .stdout(`$TEMP_DIR\n$TEMP_DIR${sep}dir\n$TEMP_DIR\n`)
    .runAsTest("subshell in pipeline");

  TestBuilder.command /* sh */ `
  mkdir dir
  (pwd) | cat
  (cd dir; pwd) | cat
  pwd
  `
    .ensureTempDir()
    .stdout(`$TEMP_DIR\n$TEMP_DIR${sep}dir\n$TEMP_DIR\n`)
    .runAsTest("subshell in pipeline");

  TestBuilder.command /* sh */ `
  mkdir foo
  ( ( (cd foo ; pwd) | cat) ) | ( ( (cat) ) | cat )

  `
    .ensureTempDir()
    .stdout(`$TEMP_DIR${sep}foo\n`)
    .runAsTest("imbricated subshells and pipelines");

  TestBuilder.command /* sh */ `
  echo (echo)
  `
    .error("Unexpected token: `(`")
    .runAsTest("Invalid subshell use");

  describe("ported", () => {
    // test_oE 'effect of subshell'
    TestBuilder.command /* sh */ `
  a=1
  # (a=2; echo $a; exit; echo not reached)
  # NOTE: We actually implemented exit wrong so changing this for now until we fix it
  (a=2; echo $a; exit; echo reached)
  echo $a
  `
      .stdout("2\nreached\n1\n")
      .runAsTest("effect of subshell");

    // test_x -e 23 'exit status of subshell'
    TestBuilder.command /* sh */ `
  (true; exit 23)
  `
      .exitCode(23)
      .runAsTest("exit status of subshell");

    // test_oE 'redirection on subshell'
    TestBuilder.command /* sh */ `
  (echo 1; echo 2; echo 3; echo 4) >sub_out
  # (tail -n 2) <sub_out
  cat sub_out
  `
      .error("Subshells with redirections are currently not supported. Please open a GitHub issue.")
      // .stdout("1\n2\n3\n4\n")
      .runAsTest("redirection on subshell");

    // test_oE 'subshell ending with semicolon'
    TestBuilder.command /* sh */ `
(echo foo;)
`
      .stdout("foo\n")
      .runAsTest("subshell ending with semicolon");

    // test_oE 'subshell ending with asynchronous list'
    TestBuilder.command /* sh */ `
mkfifo fifo1
(echo foo >fifo1&)
cat fifo1
`
      .stdout("foo\n")
      .todo("async commands not implemented yet")
      .runAsTest("subshell ending with asynchronous list");

    // test_oE 'newlines in subshell'
    TestBuilder.command /* sh */ `
(
echo foo
)
`
      .stdout("foo\n")
      .runAsTest("newlines in subshell");

    // test_oE 'effect of brace grouping'
    TestBuilder.command /* sh */ `
a=1
{ a=2; echo $a; exit; echo not reached; }
echo $a
`
      .stdout("2\n1\n")
      .todo("brace grouping not implemented")
      .runAsTest("effect of brace grouping");

    // test_x -e 29 'exit status of brace grouping'
    TestBuilder.command /* sh */ `
{ true; sh -c 'exit 29'; }
`
      .exitCode(29)
      .todo("brace grouping not implemented")
      .runAsTest("exit status of brace grouping");

    // test_oE 'redirection on brace grouping'
    TestBuilder.command /* sh */ `
{ echo 1; echo 2; echo 3; echo 4; } >brace_out
{ tail -n 2; } <brace_out
`
      .stdout("3\n4\n")
      .todo("brace grouping not implemented")
      .runAsTest("redirection on brace grouping");

    // test_oE 'brace grouping ending with semicolon'
    TestBuilder.command /* sh */ `
{ echo foo; }
`
      .stdout("foo\n")
      .todo("brace grouping not implemented")
      .runAsTest("brace grouping ending with semicolon");

    // test_oE 'brace grouping ending with asynchronous list'
    TestBuilder.command /* sh */ `
mkfifo fifo1
{ echo foo >fifo1& }
cat fifo1
`
      .stdout("foo\n")
      .todo("brace grouping not implemented")
      .runAsTest("brace grouping ending with asynchronous list");

    // test_oE 'newlines in brace grouping'
    TestBuilder.command /* sh */ `
{
echo foo
}
`
      .stdout("foo\n")
      .todo("brace grouping not implemented")
      .runAsTest("newlines in brace grouping");
  });
});

describe("when a command fails", () => {
  let e: Bun.$.ShellError;

  beforeAll(async () => {
    $.throws(true);
    try {
      await Bun.$`false`;
    } catch (err) {
      e = err as Bun.$.ShellError;
    } finally {
      $.nothrow();
    }
  });

  it("is an Error instance", () => expect(e).toBeInstanceOf(Error));
  it("is a ShellError instance", () => expect(e).toBeInstanceOf(Bun.$.ShellError));
  it("has a stdout buffer", () => expect(e.stdout).toBeInstanceOf(Uint8Array));
  it("has a stderr buffer", () => expect(e.stderr).toBeInstanceOf(Uint8Array));
  it("has an exit code of 1", () => expect(e.exitCode).toBe(1));
  it("is named ShellError", () => expect(e.name).toBe("ShellError"));
});

describe("ShellError constructor", () => {
  test.failing("new $.ShellError()", () => {
    const e = new Bun.$.ShellError();
    expect(e).toBeInstanceOf(Bun.$.ShellError);
    expect(e).toBeInstanceOf(Error);

    // TODO(@DonIsaac) fix constructor
    expect(e.name).toBe("ShellError");
  });
});

describe.todo("async", () => {
  TestBuilder.command`echo hi && BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e ${/* ts */ `await Bun.sleep(500); console.log('noice')`} &; echo hello`
    .stdout("hi\nhello\nnoice\n")
    .runAsTest("basic");

  TestBuilder.command`BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e ${/* ts */ `await Bun.sleep(500); console.log('noice')`} | cat &; echo hello`
    .stdout("hello\nnoice\n")
    .runAsTest("pipeline");

  TestBuilder.command`echo start > output.txt & cat output.txt`
    .file("output.txt", "hey")
    .stdout(s => expect(s).toBeOneOf(["hey", "start\n"]))
    .runAsTest("background_execution_with_output_redirection");
});

function stringifyBuffer(buffer: Uint8Array): string {
  const sentinel = sentinelByte(buffer);
  const str = new TextDecoder().decode(buffer.slice(0, sentinel));
  return str;
}

function sentinelByte(buf: Uint8Array): number {
  for (let i = 0; i < buf.byteLength; i++) {
    if (buf[i] == 0) return i;
  }
  throw new Error("No sentinel byte");
}

describe("interpolated values in assignment position", () => {
  // An `=` that arrives via an interpolated template value is data, not shell
  // syntax. The value must remain a single inert command word instead of being
  // reinterpreted as an environment-variable assignment applied to the rest of
  // the command line.
  TestBuilder.command`${"FOO_INJECTED=1"} echo hi`
    .exitCode(1)
    .stderr("bun: command not found: FOO_INJECTED=1\n")
    .runAsTest("interpolated word containing equals stays a single command word");

  // The assignment-shaped value must not land in a spawned child's environment
  // with the following word promoted to the command name.
  TestBuilder.command`${"SHELL_TEST_INJECTED=evil"} ${BUN} -e ${"console.log(process.env.SHELL_TEST_INJECTED)"}`
    .exitCode(1)
    .stderr("bun: command not found: SHELL_TEST_INJECTED=evil\n")
    .runAsTest("interpolated word containing equals is not exported to the child environment");

  // Legitimate uses keep working: a literal `=` in the template source still
  // creates an assignment even when its value is interpolated, and an
  // interpolated `=` in argument position passes through verbatim.
  TestBuilder.command`FOO=${"bar"} ${BUN} -e ${"console.log(process.env.FOO)"}`
    .stdout("bar\n")
    .runAsTest("literal assignment with interpolated value still works");
  TestBuilder.command`echo ${"a=b"}`
    .stdout("a=b\n")
    .runAsTest("interpolated equals in argument position passes through");
});

describe("interpolated values in reserved-word position", () => {
  TestBuilder.command`if true; then ${"if"} BUNISBAD; echo A; fi`
    .stdout("A\n")
    .stderr("bun: command not found: if\n")
    .runAsTest("interpolated if stays a single command word");

  TestBuilder.command`if echo A; ${"then"} echo B; then echo C; fi`
    .stdout("A\n")
    .stderr("bun: command not found: then\n")
    .runAsTest("interpolated then stays a single command word");

  TestBuilder.command`if BUNISBAD; then echo A; ${"elif"} true; then echo B; fi`
    .stdout("")
    .stderr("bun: command not found: BUNISBAD\n")
    .runAsTest("interpolated elif stays a single command word");

  TestBuilder.command`if BUNISBAD; then echo A; elif BUNISBAD2; then echo B; ${"else"} echo C; fi`
    .stdout("")
    .stderr("bun: command not found: BUNISBAD\nbun: command not found: BUNISBAD2\n")
    .runAsTest("interpolated else stays a single command word");

  TestBuilder.command`if BUNISBAD; then echo A; ${"fi"}; echo B; fi`
    .stdout("")
    .stderr("bun: command not found: BUNISBAD\n")
    .runAsTest("interpolated fi stays a single command word");

  TestBuilder.command`if BUNISBAD; then echo not true; ${"else"} echo unreachable; fi`
    .stdout("")
    .stderr("bun: command not found: BUNISBAD\n")
    .runAsTest("interpolated else inside a then body stays a plain word");

  TestBuilder.command`if BUNISBAD; then echo A; ${"fi"}; echo B; fi; echo ${"if"} ${"then"} ${"elif"} ${"else"} ${"fi"}`
    .stdout("if then elif else fi\n")
    .stderr("bun: command not found: BUNISBAD\n")
    .runAsTest("interpolated reserved words in argument position pass through");
});

test("redirect target buffer stays attached while a builtin command is running", async () => {
  // A builtin with `> ${buf}` caches the buffer's raw pointer and length for
  // the whole (asynchronous) lifetime of the command. The backing store must
  // stay alive and attached until the command finishes so the output lands in
  // memory the caller can still see.
  //
  // `ls` is used (rather than `cat`) because `cat` is in the
  // DISABLED_ON_POSIX list and delegates to the system binary on Linux/macOS,
  // which never takes the builtin ArrayBuffer redirect path. `ls` is a real
  // builtin on every platform and always suspends on a thread-pool task, so
  // the command is guaranteed to still be in flight when the detach is
  // attempted below.
  using dir = tempDir("shell-redirect-pin", { "pin.txt": "x" });
  const buffer = new Uint8Array(new ArrayBuffer(1 << 16));
  const promise = $`ls ${String(dir)} > ${buffer}`.env(bunEnv).nothrow();
  // Calling .then() starts the interpreter synchronously, so the redirect slot
  // now holds the buffer while the directory-listing task is still pending.
  const running = promise.then(o => o);

  // Attempting to detach the redirect target while the command is in flight
  // must leave the buffer attached (refusing the detach by throwing is also
  // acceptable).
  try {
    buffer.buffer.transfer();
  } catch {}
  expect(buffer.buffer.detached).toBe(false);

  await running;
  expect(stringifyBuffer(buffer)).toEqual("pin.txt\n");
});

test.skipIf(isWindows)(
  "output redirect buffer for an external command is detachable as soon as the command settles",
  async () => {
    // `> ${buf}` for an external command is pinned until the child's stdout
    // reaches EOF. Here `sh` prints and exits at once while a background
    // grandchild inherits the stdout pipe and holds it open until the gated
    // fetch below is answered. The process exit and the stderr EOF are then
    // processed long before the stdout EOF, so the stdout reader is the
    // callback that settles the promise. The code after `await` must already
    // see the buffer unpinned: a `transfer()` detaches it instead of copying.
    const buffer = new Uint8Array(new ArrayBuffer(1 << 16));
    const gate = Promise.withResolvers<void>();
    const grandchildStarted = Promise.withResolvers<void>();
    await using server = Bun.serve({
      port: 0,
      async fetch() {
        grandchildStarted.resolve();
        await gate.promise;
        return new Response("ok");
      },
    });
    const grandchildCode = `await fetch(${JSON.stringify(String(server.url))})`;
    const promise = $`sh -c ${'"$0" -e "$1" 2>/dev/null & echo hi'} ${BUN} ${grandchildCode} > ${buffer}`
      .env(bunEnv)
      .nothrow();
    const running = promise.then(o => o);
    // By the time the request arrives, `sh` has exited and the grandchild is
    // the only holder of the stdout pipe. If the command settles first, the
    // grandchild never held it: fail with the shell's output instead of
    // waiting on the gate until the test times out.
    await Promise.race([
      grandchildStarted.promise,
      running.then(r => {
        throw new Error(`command settled before the grandchild connected (exit ${r.exitCode}): ${r.stderr}`);
      }),
    ]);

    // The grandchild still holds stdout, so the buffer is pinned: a detach
    // attempt copies instead (or throws).
    try {
      buffer.buffer.transfer();
    } catch {}
    const detachedWhileOpen = buffer.buffer.detached;
    gate.resolve();
    expect(detachedWhileOpen).toBe(false);

    const result = await running;
    expect(stringifyBuffer(buffer)).toEqual("hi\n");

    buffer.buffer.transfer();
    expect(buffer.buffer.detached).toBe(true);
    expect(result.exitCode).toBe(0);
  },
);

test("a builtin stops writing to a redirect target that was resized to 0", async () => {
  const ab = new ArrayBuffer(1 << 20, { maxByteLength: 1 << 21 });
  const buffer = new Uint8Array(ab);
  // .then() starts the interpreter. `yes` writes its first batch and queues the next one.
  const running = $`yes > ${buffer}`
    .env(bunEnv)
    .quiet()
    .nothrow()
    .then(o => o);
  await Promise.resolve();
  ab.resize(0);

  const result = await running;
  expect(result.stderr.toString()).toBe("yes: ENOSPC\n");
  expect(result.exitCode).toBe(1);
});

describe.each(["> ", "2>&1 "])("an external command with a `%s${buf}` redirect", redirect => {
  test.skipIf(isWindows)("drops the output that arrives after the target was resized to 0", async () => {
    const ab = new ArrayBuffer(1 << 20, { maxByteLength: 1 << 21 });
    const buffer = new Uint8Array(ab);
    const gate = Promise.withResolvers<void>();
    const childWaiting = Promise.withResolvers<void>();
    await using server = Bun.serve({
      port: 0,
      async fetch() {
        childWaiting.resolve();
        await gate.promise;
        return new Response("ok");
      },
    });
    // The second write waits for the fetch, so it arrives after the resize.
    const childCode = `
      const chunk = Buffer.alloc(1 << 16, 0x41);
      process.stdout.write(chunk);
      await fetch(${JSON.stringify(String(server.url))});
      process.stdout.write(chunk);
    `;
    const running = $`${BUN} -e ${childCode} ${{ raw: redirect }}${buffer}`
      .env(bunEnv)
      .quiet()
      .nothrow()
      .then(o => o);

    await Promise.race([
      childWaiting.promise,
      running.then(r => {
        throw new Error(`command settled before the child connected (exit ${r.exitCode}): ${r.stderr}`);
      }),
    ]);
    ab.resize(0);
    gate.resolve();

    const result = await running;
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

test("a builtin stops writing to a redirect target whose WebAssembly.Memory grew", async () => {
  // Without fast memory, grow() moves the block. Without the Gigacage, the old block is unmapped.
  const child = `
    const mem = new WebAssembly.Memory({ initial: 128, maximum: 132 });
    const target = new Uint8Array(mem.buffer);
    const running = Bun.$\`yes > \${target}\`.quiet().nothrow().then(o => o);
    await Promise.resolve();
    const wroteBeforeGrow = target[0] === 0x79 && target[1] === 0x0a;
    mem.grow(4);
    const result = await running;
    console.log(JSON.stringify({ wroteBeforeGrow, exitCode: result.exitCode, stderr: result.stderr.toString() }));
  `;
  await using proc = Bun.spawn({
    cmd: [BUN, "-e", child],
    env: { ...bunEnv, BUN_JSC_useWasmFastMemory: "0", Malloc: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr }).toEqual({
    stdout: JSON.stringify({ wroteBeforeGrow: true, exitCode: 1, stderr: "yes: ENOSPC\n" }),
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

test("stdin redirect from a Uint8Array sends the bytes captured when the command starts", async () => {
  // `< ${buf}` snapshots the buffer's contents when the command starts and
  // streams them to the child's stdin across multiple event-loop turns.
  // Mutating or detaching the source buffer after the command has started
  // must not change what the child receives.
  const SIZE = 4 * 1024 * 1024;
  const input = new Uint8Array(SIZE).fill(0x41); // "A"
  const childCode = `
    const bytes = new Uint8Array(await Bun.stdin.arrayBuffer());
    let a = 0;
    let other = 0;
    for (const byte of bytes) {
      if (byte === 0x41) a++;
      else other++;
    }
    console.log(JSON.stringify({ total: bytes.length, a, other }));
  `;

  const promise = $`${BUN} -e ${childCode} < ${input}`.env(bunEnv).nothrow();
  // Calling .then() starts the interpreter synchronously, so the stdin
  // redirect has captured the buffer's contents while the child process is
  // still starting up and has read at most a pipe-buffer's worth of data.
  const running = promise.then(o => o);

  // Overwrite every byte of the source buffer, then detach it. Neither may
  // affect the bytes delivered to the child.
  input.fill(0x42); // "B"
  try {
    input.buffer.transfer();
  } catch {}

  const result = await running;
  expect(JSON.parse(result.stdout.toString())).toEqual({ total: SIZE, a: SIZE, other: 0 });
  expect(result.exitCode).toBe(0);
}, 60_000);

describe("stdin redirect from a zero-length buffer delivers EOF to the spawned command", () => {
  // A spawned command reading stdin (cat) must see EOF when the redirect
  // source is an empty ArrayBuffer/TypedArray, same as an empty Blob.
  const cases: Array<[string, ArrayBufferLike | ArrayBufferView | Blob]> = [
    ["ArrayBuffer(0)", new ArrayBuffer(0)],
    ["Uint8Array(0)", new Uint8Array(0)],
    ["Buffer.alloc(0)", Buffer.alloc(0)],
    ["DataView(0)", new DataView(new ArrayBuffer(0))],
    ["SharedArrayBuffer(0)", new SharedArrayBuffer(0)],
    ["Uint8Array(64).subarray(3, 3)", new Uint8Array(64).subarray(3, 3)],
    ["Blob([])", new Blob([])],
  ];
  test.concurrent.each(cases)("%s", async (_name, input) => {
    const result = await $`${BUN} -e ${"process.stdout.write(await Bun.stdin.text())"} < ${input}`
      .env(bunEnv)
      .nothrow();
    expect({
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
      exitCode: result.exitCode,
    }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });
});

describe.skipIf(isWindows)("stdin redirect whose pipe outlives the command's process", () => {
  // `< ${input}` is pumped into the child over a pipe. A command finishes once
  // its exit code and the stdin, stdout and stderr closes are all in, and the
  // four arrive as separate event-loop callbacks. Here the child hands its
  // stdin to a background `sleep` and exits without reading the redirect,
  // which is bigger than the pipe buffer: the exit and the stdout/stderr EOFs
  // are processed first, and the pending stdin write only fails once `sleep`
  // lets go of the pipe. That stdin close is what has to finish the command.
  // Without it the promise never settles.
  const SIZE = 1 << 20;
  const script = "exec 3<&0; sleep 1 <&3 >/dev/null 2>&1 & echo out; echo err >&2; exit 3";
  const redirects: Array<[string, () => Buffer | Blob]> = [
    ["Buffer", () => Buffer.alloc(SIZE, "a")],
    ["Blob", () => new Blob([Buffer.alloc(SIZE, "a")])],
  ];

  test.concurrent.each(redirects)("%s", async (_name, input) => {
    const r = await $`sh -c ${script} < ${input()}`.quiet().nothrow();
    expect({ stdout: r.stdout.toString(), stderr: r.stderr.toString(), exitCode: r.exitCode }).toEqual({
      stdout: "out\n",
      stderr: "err\n",
      exitCode: 3,
    });
  });

  test.concurrent("inside a pipeline", async () => {
    const r = await $`sh -c ${script} < ${Buffer.alloc(SIZE, "a")} | cat`.quiet().nothrow();
    expect({ stdout: r.stdout.toString(), stderr: r.stderr.toString(), exitCode: r.exitCode }).toEqual({
      stdout: "out\n",
      stderr: "err\n",
      exitCode: 0,
    });
  });
});

test("output redirect buffer for an external command stays attached until the command finishes", async () => {
  // `> ${buf}` for an external (non-builtin) command stores the buffer and
  // copies the child's stdout into it as chunks arrive across event-loop
  // turns. The backing store must therefore stay attached for the whole
  // duration of the command so those writes land in memory the caller still
  // owns. (The builtin equivalent of this test is directly above; this one
  // spawns a real subprocess so it goes through the subprocess output path.)
  const buffer = new Uint8Array(new ArrayBuffer(1 << 16));
  const childCode = "console.log('external-redirect-output')";
  const promise = $`${BUN} -e ${childCode} > ${buffer}`.env(bunEnv).nothrow();
  // Calling .then() starts the interpreter synchronously, so the redirect
  // slot already holds the buffer while the child process is still running.
  const running = promise.then(o => o);

  // Attempting to detach the redirect target while the command is in flight
  // must leave the buffer attached (refusing the detach by throwing is also
  // acceptable).
  try {
    buffer.buffer.transfer();
  } catch {}
  expect(buffer.buffer.detached).toBe(false);

  const result = await running;
  expect(stringifyBuffer(buffer)).toEqual("external-redirect-output\n");
  expect(result.exitCode).toBe(0);
});

test("cd treats interpolated arguments starting with tilde or dash as literal directory names", async () => {
  // A value that arrives via template interpolation is data, not shell
  // syntax: `cd ${value}` must change into the directory literally named by
  // the value, even when it begins with `~` or `-`, instead of being
  // reinterpreted as "go to $HOME" or "go to the previous directory".
  using dir = tempDir("cd-literal-arg", {
    "~": { "marker.txt": "tilde-dir\n" },
    "-p": { "marker.txt": "dash-dir\n" },
  });
  const cwd = String(dir).replaceAll("\\", "/");

  // Interpolated value beginning with `~` is a literal relative path.
  {
    const { stdout, stderr, exitCode } = await $`cd ${"~"} && cat marker.txt`.cwd(cwd).quiet().nothrow();
    expect(stderr.toString()).toBe("");
    expect(stdout.toString()).toBe("tilde-dir\n");
    expect(exitCode).toBe(0);
  }

  // Interpolated value beginning with `-` is a literal relative path.
  {
    const { stdout, stderr, exitCode } = await $`cd ${"-p"} && cat marker.txt`.cwd(cwd).quiet().nothrow();
    expect(stderr.toString()).toBe("");
    expect(stdout.toString()).toBe("dash-dir\n");
    expect(exitCode).toBe(0);
  }

  // A nonexistent interpolated target reports an error naming that exact
  // value rather than silently changing to some other directory.
  {
    const { stdout, stderr, exitCode } = await $`cd ${"~does-not-exist"} && cat marker.txt`.cwd(cwd).quiet().nothrow();
    expect(stderr.toString()).toContain("~does-not-exist");
    expect(stdout.toString()).toBe("");
    expect(exitCode).toBe(1);
  }
});

test.each([
  ["ASCII", "a\0b"],
  ["Latin-1", "caf\xe9\0b"],
  ["UTF-16", "\u4e2d\0b"],
])(".cwd() and .env() reject a %s string with a NUL byte", (_, value) => {
  const error = (name: string) => ({
    code: "ERR_INVALID_ARG_VALUE",
    message: `The shell ${name} must be a string without null bytes. Received ${JSON.stringify(value)}`,
  });
  expect(() => $`true`.cwd(value)).toThrow(error("cwd"));
  expect(() => $`true`.env({ [value]: "1" })).toThrow(error("env key"));
  expect(() => $`true`.env({ X: value })).toThrow(error("env value"));
  expect(() => new $.Shell().cwd(value)`true`).toThrow(error("cwd"));
});

test(".env() rejects a NUL byte at any offset in an ASCII string and copies clean strings unchanged", async () => {
  const env: Record<string, string> = { LATIN1: "caf\xe9", UTF16: "\u4e2d", EMPTY: "" };
  const error = expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" });
  for (const length of [1, 7, 8, 9, 17, 33, 129, 200]) {
    const clean = Buffer.alloc(length, "\x01a~\x7f").latin1Slice();
    env["V" + length] = clean;
    for (const at of length > 33 ? [0, 64, length - 9, length - 1] : Array(length).keys()) {
      const value = clean.slice(0, at) + "\0" + clean.slice(at + 1);
      expect(() => $`true`.env({ X: value })).toThrow(error);
      expect(() => $`true`.env({ [value]: "1" })).toThrow(error);
    }
  }
  const raw = `echo "[$${Object.keys(env).join("][$")}]"`;
  expect(await $`${{ raw }}`.env(env).text()).toBe(`[${Object.values(env).join("][")}]\n`);
});

describe("literal digits after an interpolated value", () => {
  TestBuilder.command`echo ${"a b"}0`
    .stdout("a b0\n")
    .runAsTest("a literal digit after an interpolated string is preserved");

  TestBuilder.command`echo ${5}0`.stdout("50\n").runAsTest("a literal digit after an interpolated number is preserved");

  TestBuilder.command`echo ${"a b"}1 ${"c d"}`
    .stdout("a b1 c d\n")
    .runAsTest("each interpolated value keeps its own slot when followed by a literal digit");
});

test.skipIf(isWindows)("external command resolution uses the PATH from the shell environment", async () => {
  using dir = tempDir("shell-argv0-path", {
    "onlyintool": "#!/bin/sh\necho from-onlyintool\n",
  });
  chmodSync(join(String(dir), "onlyintool"), 0o755);
  const toolDir = String(dir).replaceAll("\\", "/");

  {
    const { stdout, stderr, exitCode } = await $`onlyintool`
      .env({ ...bunEnv, PATH: toolDir })
      .quiet()
      .nothrow();
    expect(stderr.toString()).toBe("");
    expect(stdout.toString()).toBe("from-onlyintool\n");
    expect(exitCode).toBe(0);
  }

  {
    const { stdout, stderr, exitCode } = await $`PATH=${toolDir} onlyintool`.quiet().nothrow();
    expect(stderr.toString()).toBe("");
    expect(stdout.toString()).toBe("from-onlyintool\n");
    expect(exitCode).toBe(0);
  }

  {
    const { stdout, stderr, exitCode } = await $`export PATH=${toolDir}; onlyintool`.quiet().nothrow();
    expect(stderr.toString()).toBe("");
    expect(stdout.toString()).toBe("from-onlyintool\n");
    expect(exitCode).toBe(0);
  }
});

// Windows joins each file operand onto the shell's cwd in one path buffer. POSIX passes operands to the *at() syscalls.
test.if(isWindows)("operands longer than the path buffer fail with ENAMETOOLONG", async () => {
  using dir = tempDir("shell-long-operand", { "in.txt": "content\n" });
  const script = `
    import { $ } from "bun";
    $.nothrow();
    $.cwd(process.env.SHELL_CWD);
    const long = Buffer.alloc(100_000, "a").toString();
    // Too long as written, but normalizes to a short name inside the cwd.
    const collapsing = Buffer.alloc(100_000, "a/../").toString();
    const show = buf => buf.toString().replaceAll(long, "<long>").replaceAll(collapsing, "<collapsing>");
    const run = async promise => {
      const { exitCode, stdout, stderr } = await promise.quiet();
      return { exitCode, stdout: show(stdout), stderr: show(stderr) };
    };
    console.log(
      JSON.stringify({
        cat: await run($\`cat \${long}\`),
        redirect: await run($\`echo hi > \${long}\`),
        isFile: await run($\`[[ -f \${long} ]]\`),
        rootedCat: await run($\`cat \${"/" + long}\`),
        rootedLs: await run($\`ls \${"/" + long}\`),
        rootedMvTarget: await run($\`mv in.txt \${"/" + long}\`),
        rootedRedirect: await run($\`echo hi > \${"/" + long}\`),
        rootedIsDir: await run($\`[[ -d \${"/" + long} ]]\`),
        collapsingCat: await run($\`cat \${collapsing + "in.txt"}\`),
        collapsingIsFile: await run($\`[[ -f \${collapsing + "in.txt"} ]]\`),
        collapsingRedirect: await run($\`echo hi > \${collapsing + "out.txt"}\`),
      }),
    );
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, SHELL_CWD: String(dir) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const failed = (stderr: string) => ({ exitCode: 1, stdout: "", stderr });
  const succeeded = (stdout: string) => ({ exitCode: 0, stdout, stderr: "" });
  expect(JSON.parse(stdout)).toEqual({
    cat: failed("cat: <long>: File name too long\n"),
    redirect: failed("bun: File name too long: <long>"),
    isFile: failed(""),
    rootedCat: failed("cat: /<long>: File name too long\n"),
    rootedLs: failed("ls: /<long>: File name too long\n"),
    rootedMvTarget: failed("mv: /<long>: File name too long\n"),
    rootedRedirect: failed("bun: File name too long: /<long>"),
    rootedIsDir: failed(""),
    collapsingCat: succeeded("content\n"),
    collapsingIsFile: succeeded(""),
    collapsingRedirect: succeeded(""),
  });
  expect(await Bun.file(join(String(dir), "in.txt")).text()).toBe("content\n");
  expect(await Bun.file(join(String(dir), "out.txt")).text()).toBe("hi\n");
  expect(exitCode).toBe(0);
});
