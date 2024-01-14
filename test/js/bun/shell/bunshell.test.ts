/**
 * Portions of these tests are derived from the [deno_task_shell](https://github.com/denoland/deno_task_shell/) tests, which are developed and maintained by the Deno authors.
 * Copyright 2018-2023 the Deno authors.
 *
 * This code is licensed under the MIT License: https://opensource.org/licenses/MIT
 */
import { $ } from "bun";
import { access, mkdir, mkdtemp, readlink, realpath, rm, writeFile, copyFile } from "fs/promises";
import { join, relative } from "path";
import { TestBuilder, redirect } from "./util";
import { tmpdir } from "os";
import { describe, test, afterAll, beforeAll, expect } from "bun:test";
import {
  randomInvalidSurrogatePair,
  randomLoneSurrogate,
  runWithError,
  runWithErrorPromise,
  tempDirWithFiles,
} from "harness";

let temp_dir: string;
const temp_files = ["foo.txt", "lmao.ts"];
beforeAll(async () => {
  temp_dir = await mkdtemp(join(await realpath(tmpdir()), "bun-add.test"));
  for (const file of temp_files) {
    const writer = Bun.file(join(temp_dir, file)).writer();
    writer.write("foo");
    writer.end();
  }
});

afterAll(async () => {
  await rm(temp_dir, { force: true, recursive: true });
});

const BUN = process.argv0;

describe("bunshell", () => {
  describe("echo+cmdsubst edgecases", async () => {
    async function doTest(cmd: string, expected: string) {
      test(cmd, async () => {
        const { stdout } = await $`${cmd}`;
        expect(stdout.toString()).toEqual(expected);
      });
    }

    // funny/crazy edgecases thanks to @paperdave and @Electroid
    doTest(`echo "$(echo 1; echo 2)"`, "1\n2\n");
    doTest(`echo "$(echo "1" ; echo "2")"`, "1\n2\n");
    doTest(`echo $(echo 1; echo 2)`, "1 2\n");
  });

  describe("unicode", () => {
    test("basic", async () => {
      const whatsupbro = "元気かい、兄弟";
      const { stdout } = await $`echo ${whatsupbro}`;

      expect(stdout.toString("utf8")).toEqual(whatsupbro + "\n");
    });

    test("escape unicode", async () => {
      const { stdout } = await $`echo \\弟\\気`;

      expect(stdout.toString("utf8")).toEqual(`\弟\気\n`);
    });

    /**
     * Only A-Z, a-z, 0-9, and _ are allowed in variable names
     *
     * Using unicode in var name will interpret the assignment as a command.
     */
    //
    test("varname fails", async () => {
      const whatsupbro = "元気かい、兄弟";
      const { stdout, stderr } = await $`${whatsupbro}=NICE; echo $${whatsupbro}`;
      expect(stdout.toString()).toEqual("\n");
      expect(stderr.toString()).toEqual(`bunsh: command not found: ${whatsupbro}=NICE\n`);
    });

    test("var value", async () => {
      const error = runWithErrorPromise(async () => {
        const whatsupbro = "元気かい、兄弟";
        const { stdout } = await $`FOO=${whatsupbro}; echo $FOO`;
        expect(stdout.toString("utf-8")).toEqual(whatsupbro + "\n");
      });
      expect(error).toBeDefined();
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

    test("invalid lone surrogate fails", async () => {
      const err = await runWithErrorPromise(async () => {
        const loneSurrogate = randomLoneSurrogate();
        const buffer = new Uint8Array(8192);
        const result = await $`echo ${loneSurrogate} > ${buffer}`;
      });
      expect(err?.message).toEqual("bunshell: invalid string");
    });

    test("invalid surrogate pair fails", async () => {
      const err = await runWithErrorPromise(async () => {
        const loneSurrogate = randomInvalidSurrogatePair();
        const buffer = new Uint8Array(8192);
        const result = $`echo ${loneSurrogate} > ${buffer}`;
      });
      expect(err?.message).toEqual("bunshell: invalid string");
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

    await $`${BUN} -e "${code}" 2> ${buffer}`;

    console.log(buffer);
    expect(new TextDecoder().decode(buffer.slice(0, sentinelByte(buffer)))).toEqual(
      `LMAO\nLMAO\nLMAO\nLMAO\nLMAO\nLMAO\nLMAO\nLMAO\nLMAO\nLMAO\n`,
    );
  });

  test("pipeline", async () => {
    const { stdout } = await $`echo "LMAO" | cat`;

    expect(stdout.toString()).toEqual("LMAO\n");
  });

  test("cmd subst", async () => {
    const haha = "noice";
    const { stdout } = await $`echo $(echo noice)`;
    expect(stdout.toString()).toEqual(`noice\n`);
  });

  describe("brace expansion", () => {
    function doTest(pattern: string, expected: string) {
      test(pattern, async () => {
        const { stdout } = await $`echo ${pattern} `;
        expect(stdout.toString()).toEqual(`${expected}\n`);
      });
    }

    test("concatenated", () => {
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
      const { stdout } = await $`FOO=bar BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e "console.log(JSON.stringify(process.env))"`;
      const str = stdout.toString();
      expect(JSON.parse(str)).toEqual({
        ...process.env,
        FOO: "bar",
        BUN_DEBUG_QUIET_LOGS: "1",
      });
    });

    test("expand shell var", async () => {
      const { stdout } = await $`FOO=bar BAR=baz; echo $FOO $BAR`;
      const str = stdout.toString();

      expect(str).toEqual("bar baz\n");
    });

    test("shell var", async () => {
      const { stdout } =
        await $`FOO=bar BAR=baz && BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e "console.log(JSON.stringify(process.env))"`;
      const str = stdout.toString();

      const procEnv = JSON.parse(str);
      expect(procEnv.FOO).toBeUndefined();
      expect(procEnv.BAR).toBeUndefined();
      expect(procEnv).toEqual({ ...process.env, BUN_DEBUG_QUIET_LOGS: "1" });
    });

    test("export var", async () => {
      const buffer = Buffer.alloc(8192);
      const buffer2 = Buffer.alloc(8192);
      await $`export FOO=bar && BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e "console.log(JSON.stringify(process.env))" > ${buffer} && BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e "console.log(JSON.stringify(process.env))" > ${buffer2}`;

      const str1 = stringifyBuffer(buffer);
      const str2 = stringifyBuffer(buffer2);

      console.log("Str1", str1);

      let procEnv = JSON.parse(str1);
      expect(procEnv).toEqual({ ...process.env, BUN_DEBUG_QUIET_LOGS: "1", FOO: "bar" });
      procEnv = JSON.parse(str2);
      expect(procEnv).toEqual({ ...process.env, BUN_DEBUG_QUIET_LOGS: "1", FOO: "bar" });
    });

    test("syntax edgecase", async () => {
      const buffer = new Uint8Array(8192);
      const shellProc =
        await $`FOO=bar BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e "console.log(JSON.stringify(process.env))"> ${buffer}`;

      const str = stringifyBuffer(buffer);

      const procEnv = JSON.parse(str);

      expect(procEnv).toEqual({ ...process.env, BUN_DEBUG_QUIET_LOGS: "1", FOO: "bar" });
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
      expect(stdout.toString()).toEqual(`${temp_dir}\n${process.cwd()}\n`);
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
      "foo": "bar",
      "bar": "baz",
      "dir": {
        "some": "more",
        "files": "here",
      },
    };
    beforeAll(() => {
      temp_dir = tempDirWithFiles("temp-rm", files);
    });

    test("error without recursive option", async () => {
      const { stderr } = await $`rm -v ${temp_dir}`;
      expect(stderr.toString()).toEqual(`rm: ${temp_dir}: is a directory\n`);
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
        `${temp_dir}/foo
${temp_dir}/dir/files
${temp_dir}/dir/some
${temp_dir}/dir
${temp_dir}/bar
${temp_dir}`
          .split("\n")
          .sort(),
      );
    });
  });

  /**
   *
   */
  describe("escaping", () => {});
});

describe("deno_task", () => {
  test("commands", async () => {
    await TestBuilder.command`echo 1`.stdout("1\n").run();
    await TestBuilder.command`echo 1 2   3`.stdout("1 2 3\n").run();
    await TestBuilder.command`echo "1 2   3"`.stdout("1 2   3\n").run();
    await TestBuilder.command`echo 1 2\\ \\ \\ 3`.stdout("1 2   3\n").run();
    await TestBuilder.command`echo "1 2\\ \\ \\ 3"`.stdout("1 2\\ \\ \\ 3\n").run();
    await TestBuilder.command`echo test$(echo 1    2)`.stdout("test1 2\n").run();
    await TestBuilder.command`echo test$(echo "1    2")`.stdout("test1 2\n").run();
    await TestBuilder.command`echo "test$(echo "1    2")"`.stdout("test1    2\n").run();
    await TestBuilder.command`echo test$(echo "1 2 3")`.stdout("test1 2 3\n").run();
    await TestBuilder.command`VAR=1 BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e 'console.log(process.env.VAR)' && echo $VAR`
      .stdout("1\n\n")
      .run();
    await TestBuilder.command`VAR=1 VAR2=2 BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e 'console.log(process.env.VAR + process.env.VAR2)'`
      .stdout("12\n")
      .run();
    await TestBuilder.command`EMPTY= BUN_DEBUG_QUIET_LOGS=1 bun -e 'console.log(\`EMPTY: \${process.env.EMPTY}\`)'`
      .stdout("EMPTY: \n")
      .run();
    await TestBuilder.command`"echo" "1"`.stdout("1\n").run();
    await TestBuilder.command`echo test-dashes`.stdout("test-dashes\n").run();
    await TestBuilder.command`echo 'a/b'/c`.stdout("a/b/c\n").run();
    await TestBuilder.command`echo 'a/b'ctest\"te  st\"'asdf'`.stdout("a/bctestte  stasdf\n").run();
    await TestBuilder.command`echo --test=\"2\" --test='2' test\"TEST\" TEST'test'TEST 'test''test' test'test'\"test\" \"test\"\"test\"'test'`
      .stdout("--test=2 --test=2 testTEST TESTtestTEST testtest testtesttest testtesttest\n")
      .run();
  });

  test("boolean logic", async () => {
    await TestBuilder.command`echo 1 && echo 2 || echo 3`.stdout("1\n2\n").run();
    await TestBuilder.command`echo 1 || echo 2 && echo 3`.stdout("1\n3\n").run();

    await TestBuilder.command`echo 1 || (echo 2 && echo 3)`.error(TestBuilder.UNEXPECTED_SUBSHELL_ERROR_OPEN).run();
    await TestBuilder.command`false || false || (echo 2 && false) || echo 3`
      .error(TestBuilder.UNEXPECTED_SUBSHELL_ERROR_OPEN)
      .run();
    // await TestBuilder.command`echo 1 || (echo 2 && echo 3)`.stdout("1\n").run();
    // await TestBuilder.command`false || false || (echo 2 && false) || echo 3`.stdout("2\n3\n").run();
  });

  test("command substitution", async () => {
    await TestBuilder.command`echo $(echo 1)`.stdout("1\n").run();
    await TestBuilder.command`echo $(echo 1 && echo 2)`.stdout("1 2\n").run();
    // TODO Sleep tests
  });

  test("shell variables", async () => {
    await TestBuilder.command`echo $VAR && VAR=1 && echo $VAR && deno eval 'console.log(Deno.env.get("VAR"))'"`
      .stdout("\n1\nundefined\n")
      .run();

    await TestBuilder.command`VAR=1 && echo $VAR$VAR`.stdout("11\n").run();

    await TestBuilder.command`VAR=1 && echo Test$VAR && echo $(echo "Test: $VAR") ; echo CommandSub$($VAR) ; echo $ ; echo \\$VAR`
      .stdout("Test1\nTest: 1\nCommandSub\n$\n$VAR\n")
      .stderr("bunsh: command not found: 1\n")
      .run();
  });

  test("env variables", async () => {
    await TestBuilder.command`echo $VAR && export VAR=1 && echo $VAR && BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e 'console.log(process.env.VAR)'`
      .stdout("\n1\n1\n")
      .run();

    await TestBuilder.command`export VAR=1 VAR2=testing VAR3="test this out" && echo $VAR $VAR2 $VAR3`
      .stdout("1 testing test this out\n")
      .run();
  });

  test("pipeline", async () => {
    await TestBuilder.command`echo 1 | BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e 'process.stdin.pipe(process.stdout)'`
      .stdout("1\n")
      .run();

    await TestBuilder.command`echo 1 | echo 2 && echo 3`.stdout("2\n3\n").run();

    // await TestBuilder.command`echo $(sleep 0.1 && echo 2 & echo 1) | BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e 'await Deno.stdin.readable.pipeTo(Deno.stdout.writable)'`
    //   .stdout("1 2\n")
    //   .run();

    await TestBuilder.command`echo 2 | echo 1 | BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e 'process.stdin.pipe(process.stdout)'`
      .stdout("1\n")
      .run();

    await TestBuilder.command`BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e 'console.log(1); console.error(2);' | BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e 'process.stdin.pipe(process.stdout)'`
      .stdout("1\n")
      .stderr("2\n")
      .run();

    await TestBuilder.command`BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e 'console.log(1); console.error(2);' |& BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e 'process.stdin.pipe(process.stdout)'`
      // .stdout("1\n2\n")
      .error("Piping stdout and stderr (`|&`) is not supported yet. Please file an issue on GitHub.")
      .run();

    // await TestBuilder.command`BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e 'console.log(1); console.error(2);' | BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e 'setTimeout(async () => { await Deno.stdin.readable.pipeTo(Deno.stderr.writable) }, 10)' |& BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e 'await Deno.stdin.readable.pipeTo(Deno.stderr.writable)'`
    //   .stderr("2\n1\n")
    //   .run();

    await TestBuilder.command`echo 1 |& BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e 'process.stdin.pipe(process.stdout)'`
      // .stdout("1\n")
      .error("Piping stdout and stderr (`|&`) is not supported yet. Please file an issue on GitHub.")
      .run();

    await TestBuilder.command`echo 1 | BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e 'process.stdin.pipe(process.stdout)' > output.txt`
      .fileEquals("output.txt", "1\n")
      .run();

    await TestBuilder.command`echo 1 | BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e 'process.stdin.pipe(process.stderr)' 2> output.txt`
      .fileEquals("output.txt", "1\n")
      .run();
  });
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

const foo = {
  "stmts": [
    {
      "exprs": [
        {
          "cmd": {
            "assigns": [],
            "name_and_args": [{ "simple": { "Text": "echo" } }],
            "redirect": { "stdin": false, "stdout": true, "stderr": false, "append": false, "__unused": 0 },
            "redirect_file": { "jsbuf": { "idx": 0 } },
          },
        },
      ],
    },
  ],
};

const lex = [
  { "Text": "echo" },
  { "Delimit": {} },
  { "CmdSubstBegin": {} },
  { "Text": "echo" },
  { "Delimit": {} },
  { "Text": "ハハ" },
  { "Delimit": {} },
  { "CmdSubstEnd": {} },
  { "Redirect": { "stdin": false, "stdout": true, "stderr": false, "append": false, "__unused": 0 } },
  { "JSObjRef": 0 },
  { "Eof": {} },
];

const lex2 = [
  { "Text": "echo" },
  { "Delimit": {} },
  { "CmdSubstBegin": {} },
  { "Text": "echo" },
  { "Delimit": {} },
  { "Text": "noice" },
  { "Delimit": {} },
  { "CmdSubstEnd": {} },
  { "Redirect": { "stdin": false, "stdout": true, "stderr": false, "append": false, "__unused": 0 } },
  { "JSObjRef": 0 },
  { "Eof": {} },
];

const parse2 = {
  "stmts": [
    {
      "exprs": [
        {
          "cmd": {
            "assigns": [],
            "name_and_args": [{ "simple": { "Text": "echo" } }],
            "redirect": { "stdin": false, "stdout": true, "stderr": false, "append": false, "__unused": 0 },
            "redirect_file": { "jsbuf": { "idx": 0 } },
          },
        },
      ],
    },
  ],
};

const lsdkjfs = {
  "stmts": [
    {
      "exprs": [
        {
          "cmd": {
            "assigns": [],
            "name_and_args": [{ "simple": { "Text": "echo" } }],
            "redirect": { "stdin": false, "stdout": true, "stderr": false, "append": false, "__unused": 0 },
            "redirect_file": { "jsbuf": { "idx": 0 } },
          },
        },
      ],
    },
  ],
};
