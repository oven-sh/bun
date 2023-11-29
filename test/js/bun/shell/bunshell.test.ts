import { $ } from "bun";
import { access, mkdir, mkdtemp, readlink, realpath, rm, writeFile, copyFile } from "fs/promises";
import { join, relative } from "path";
import { redirect } from "./util";
import { tmpdir } from "os";
import { describe, test, afterAll, beforeAll, expect } from "bun:test";
import { randomInvalidSurrogatePair, randomLoneSurrogate, runWithError, tempDirWithFiles } from "harness";

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
  describe("unicode", () => {
    test("basic", () => {
      const buffer = new Uint8Array(1 << 20);
      const whatsupbro = "元気かい、兄弟";
      const result = $`echo ${whatsupbro} > ${buffer}`;

      const sentinel = sentinelByte(buffer);
      expect(new TextDecoder().decode(buffer.slice(0, sentinel))).toEqual(whatsupbro + "\n");
    });

    test("escape unicode", () => {
      const buffer = new Uint8Array(1 << 20);
      const result = $`echo \\弟\\気 > ${buffer}`;

      const sentinel = sentinelByte(buffer);
      expect(new TextDecoder().decode(buffer.slice(0, sentinel))).toEqual(`\弟\気\n`);
    });

    // Only A-Z, a-z, 0-9, and _ are allowed in variable names
    test("varname fails", () => {
      const error = runWithError(() => {
        const buffer = new Uint8Array(1 << 20);
        const whatsupbro = "元気かい、兄弟";
        const result = $`${whatsupbro}=NICE; echo $${whatsupbro} > ${buffer}`;
      });
      expect(error).toBeDefined();
    });

    test("var value", () => {
      const error = runWithError(() => {
        const buffer = new Uint8Array(1 << 20);
        const whatsupbro = "元気かい、兄弟";
        const result = $`FOO=${whatsupbro}; echo $FOO > ${buffer}`;
        const sentinel = sentinelByte(buffer);
        expect(new TextDecoder().decode(buffer.slice(0, sentinel))).toEqual(whatsupbro + "\n");
      });
      expect(error).toBeDefined();
    });

    test("in compound word", () => {
      const buffer = new Uint8Array(1 << 20);
      const whatsupbro = "元気かい、兄弟";
      const holymoly = "ホーリーモーリー";
      const result = $`echo "${whatsupbro}&&nice"${holymoly} > ${buffer}`;

      const sentinel = sentinelByte(buffer);
      expect(new TextDecoder().decode(buffer.slice(0, sentinel))).toEqual(`${whatsupbro}&&nice${holymoly}\n`);
    });

    test("cmd subst", () => {
      const buffer = new Uint8Array(1 << 20);
      const haha = "ハハ";
      const result = $`echo $(echo ${haha}) > ${buffer}`;

      const sentinel = sentinelByte(buffer);
      expect(new TextDecoder().decode(buffer.slice(0, sentinel))).toEqual(`${haha}\n`);
    });

    test("invalid lone surrogate fails", () => {
      const err = runWithError(() => {
        const loneSurrogate = randomLoneSurrogate();
        const buffer = new Uint8Array(8192);
        const result = $`echo ${loneSurrogate} > ${buffer}`;
      });
      expect(err?.message).toEqual("bunshell: invalid string");
    });

    test("invalid surrogate pair fails", () => {
      const err = runWithError(() => {
        const loneSurrogate = randomInvalidSurrogatePair();
        const buffer = new Uint8Array(8192);
        const result = $`echo ${loneSurrogate} > ${buffer}`;
      });
      expect(err?.message).toEqual("bunshell: invalid string");
    });
  });

  test("redirect Uint8Array", async () => {
    const buffer = new Uint8Array(1 << 20);
    const result = $`cat ${import.meta.path} > ${buffer}`;

    const sentinel = sentinelByte(buffer);
    const thisFile = Bun.file(import.meta.path);

    expect(new TextDecoder().decode(buffer.slice(0, sentinel))).toEqual(await thisFile.text());
  });

  test("redirect Bun.File", async () => {
    const filepath = join(temp_dir, "lmao.txt");
    const file = Bun.file(filepath);
    const thisFileText = await Bun.file(import.meta.path).text();
    const result = $`cat ${import.meta.path} > ${file}`;

    expect(await file.text()).toEqual(thisFileText);
  });

  test("redirect stderr", () => {
    const buffer = new Uint8Array(1 << 20);
    const code = /* ts */ `
    for (let i = 0; i < 10; i++) {
      console.error('LMAO')
    }
    `;

    $`${BUN} -e "${code}" 2> ${buffer}`;

    const sentinel = sentinelByte(buffer);
    expect(new TextDecoder().decode(buffer.slice(0, sentinel))).toEqual(
      `LMAO\nLMAO\nLMAO\nLMAO\nLMAO\nLMAO\nLMAO\nLMAO\nLMAO\nLMAO\n`,
    );
  });

  test("pipeline", () => {
    const buffer = new Uint8Array(1 << 20);
    const result = $`echo "LMAO" | cat > ${buffer}`;

    const sentinel = sentinelByte(buffer);
    expect(new TextDecoder().decode(buffer.slice(0, sentinel))).toEqual("LMAO\n");
  });

  test("cmd subst", () => {
    const buffer = new Uint8Array(1 << 20);
    const haha = "noice";
    console.log($`echo $(echo noice) > ${buffer}`);
    expect(stringifyBuffer(buffer)).toEqual(`noice\n`);
  });

  describe("brace expansion", () => {
    test("basic", () => {
      const buffer = new Uint8Array(512);
      const result = $`echo {a,b,c}{d,e,f} > ${buffer}`;
      const sentinel = sentinelByte(buffer);
      expect(new TextDecoder().decode(buffer.slice(0, sentinel))).toEqual("ad ae af bd be bf cd ce cf\n");
    });

    describe("nested", () => {
      function doTest(pattern: string, expected: string, buffer: Uint8Array = new Uint8Array(512)) {
        test(pattern, () => {
          const result = $`echo ${pattern} > ${buffer}`;
          const sentinel = sentinelByte(buffer);
          expect(new TextDecoder().decode(buffer.slice(0, sentinel))).toEqual(`${expected}\n`);
        });
      }

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

    test("command", () => {
      const buffer = new Uint8Array(512);
      const result = $`{echo,a,b,c} {d,e,f} > ${buffer}`;
      const sentinel = sentinelByte(buffer);
      expect(new TextDecoder().decode(buffer.slice(0, sentinel))).toEqual("a b c d e f\n");
    });
  });

  describe("variables", () => {
    test("cmd_local_var", () => {
      const buffer = new Uint8Array(8192);
      $`FOO=bar BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e "console.log(JSON.stringify(process.env))" > ${buffer}`;
      const sentinel = sentinelByte(buffer);
      const str = new TextDecoder().decode(buffer.slice(0, sentinel));
      expect(JSON.parse(str)).toEqual({
        ...process.env,
        FOO: "bar",
        BUN_DEBUG_QUIET_LOGS: "1",
      });
    });

    test("expand shell var", () => {
      const buffer = new Uint8Array(8192);
      $`FOO=bar BAR=baz; echo $FOO $BAR > ${buffer}`;
      const sentinel = sentinelByte(buffer);
      const str = new TextDecoder().decode(buffer.slice(0, sentinel));

      expect(str).toEqual("bar baz\n");
    });

    test("shell var", () => {
      const buffer = new Uint8Array(8192);
      $`FOO=bar BAR=baz && BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e "console.log(JSON.stringify(process.env))" > ${buffer}`;
      const sentinel = sentinelByte(buffer);
      const str = new TextDecoder().decode(buffer.slice(0, sentinel));

      const procEnv = JSON.parse(str);
      expect(procEnv.FOO).toBeUndefined();
      expect(procEnv.BAR).toBeUndefined();
      expect(procEnv).toEqual({ ...process.env, BUN_DEBUG_QUIET_LOGS: "1" });
    });

    test("export var", () => {
      const buffer = new Uint8Array(8192);
      const buffer2 = new Uint8Array(8192);
      $`export FOO=bar && BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e "console.log(JSON.stringify(process.env))" > ${buffer} && BUN_DEBUG_QUIET_LOGS=1 ${BUN} -e "console.log(JSON.stringify(process.env))" > ${buffer2}`;

      const str1 = stringifyBuffer(buffer);
      const str2 = stringifyBuffer(buffer2);

      let procEnv = JSON.parse(str1);
      expect(procEnv).toEqual({ ...process.env, BUN_DEBUG_QUIET_LOGS: "1", FOO: "bar" });
      procEnv = JSON.parse(str2);
      expect(procEnv).toEqual({ ...process.env, BUN_DEBUG_QUIET_LOGS: "1", FOO: "bar" });
    });
  });

  describe("cd & pwd", () => {
    test("cd", async () => {
      const buffer = new Uint8Array(8192);
      const result = $`cd ${temp_dir} && ls > ${buffer}`;
      const sentinel = sentinelByte(buffer);
      const str = new TextDecoder().decode(buffer.slice(0, sentinel));
      expect(str).toEqual(`${temp_files.join("\n")}\n`);
    });

    test("cd -", async () => {
      const buffer = new Uint8Array(8192);
      const result = $`cd ${temp_dir} && cd - && pwd > ${buffer}`;
      const sentinel = sentinelByte(buffer);
      const str = new TextDecoder().decode(buffer.slice(0, sentinel));
      expect(str).toEqual(`${process.cwd()}\n`);
    });
  });

  test("which", () => {
    const buffer = new Uint8Array(8192);
    const bogus = "akdfjlsdjflks";
    const result = $`which ${BUN} ${bogus}> ${buffer}`;
    const sentinel = sentinelByte(buffer);
    const str = new TextDecoder().decode(buffer.slice(0, sentinel));
    const bunWhich = Bun.which(BUN);
    expect(str).toEqual(`${bunWhich}\n${bogus} not found\n`);
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

    // test("error without recursive option", () => {
    //   const buffer = new Uint8Array(8192);
    //   const result = $`rm -v ${temp_dir} 2> ${buffer}`;
    //   const sentinel = sentinelByte(buffer);
    //   const str = new TextDecoder().decode(buffer.slice(0, sentinel));
    //   expect(str).toEqual(`rm: ${temp_dir}: is a directory\n`);
    // });

    test("recursive", () => {
      const buffer = new Uint8Array(8192);
      const result = $`rm -vrf ${temp_dir} > ${buffer}`;
      const sentinel = sentinelByte(buffer);
      const str = new TextDecoder().decode(buffer.slice(0, sentinel));
      expect(str).toEqual(
        `${temp_dir}/foo
${temp_dir}/dir/files
${temp_dir}/dir/some
${temp_dir}/dir
${temp_dir}/bar
${temp_dir}
`,
      );
    });
  });

  /**
   *
   */
  describe("escaping", () => {});
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
