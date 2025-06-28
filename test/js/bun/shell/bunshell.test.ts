/**
 * Portions of these tests are derived from the [deno_task_shell](https://github.com/denoland/deno_task_shell/) tests, which are developed and maintained by the Deno authors.
 * Copyright 2018-2023 the Deno authors.
 *
 * This code is licensed under the MIT License: https://opensource.org/licenses/MIT
 */
import { $ } from "bun";
import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import { mkdir, rm, stat } from "fs/promises";
import { bunExe, isPosix, isWindows, runWithErrorPromise, tempDirWithFiles, tmpdirSync } from "harness";
import { join, sep } from "path";
import { createTestBuilder, sortedShellOutput } from "./util";
const TestBuilder = createTestBuilder(import.meta.path);

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
    function runTest(name: string, builder: TestBuilder) {
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
      // TODO: Uncomment and replace after unicode in template tags is supported
      // expect(stdout.toString("utf8")).toEqual(`\弟\気\n`);
      // Set this here for now, because unicode in template tags while using .raw is broken, but should be fixed
      expect(stdout.toString("utf8")).toEqual("\\u5F1F\\u6C17\n");
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
    });

    test("command", async () => {
      const { stdout } = await $`{echo,a,b,c} {d,e,f}`;
      expect(stdout.toString()).toEqual("a b c d e f\n");
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
      ).toEqual(temp_files.sort());
    });

    test("cd -", async () => {
      const { stdout } = await $`cd ${temp_dir} && pwd && cd - && pwd`;
      expect(stdout.toString()).toEqual(`${temp_dir}\n${process.cwd().replaceAll("\\", "/")}\n`);
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
  });

  describe("env variables", async () => {
    TestBuilder.command`echo $VAR && export VAR=1 && echo $VAR && BUN_TEST_VAR=1 ${BUN} -e 'console.log(process.env.VAR)'`
      .stdout("\n1\n1\n")
      .runAsTest("exported vars");

    TestBuilder.command`export VAR=1 VAR2=testing VAR3="test this out" && echo $VAR $VAR2 $VAR3`
      .stdout("1 testing test this out\n")
      .runAsTest("exported vars 2");
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
      TestBuilder.command`grep hi src/js_parser.zig | echo hi`
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

  TestBuilder.command`[[ -d mydir ]] && echo yes!`.directory("mydir").stdout("yes!\n").runAsTest("-d");
  TestBuilder.command`[[ -d mumbo.jumbo ]] && echo yes!`.exitCode(1).runAsTest("-d non-existent");

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
