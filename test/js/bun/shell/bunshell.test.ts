import { $ } from "bun";
import { access, mkdir, mkdtemp, readlink, realpath, rm, writeFile, copyFile } from "fs/promises";
import { join, relative } from "path";
import { redirect } from "./util";
import { tmpdir } from "os";
import { describe, test, afterAll, beforeAll, expect } from "bun:test";

let temp_dir: string;
beforeAll(async () => {
  temp_dir = await mkdtemp(join(await realpath(tmpdir()), "bun-add.test"));
});

afterAll(async () => {
  await rm(temp_dir, { force: true, recursive: true });
});

const BUN = process.argv0;

describe("bunshell", () => {
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

  test("brace expansion", () => {
    const buffer = new Uint8Array(512);
    const result = $`echo {a,b,c}{d,e,f} > ${buffer}`;
    const sentinel = sentinelByte(buffer);
    expect(new TextDecoder().decode(buffer.slice(0, sentinel))).toEqual("ad ae af bd be bf cd ce cf\n");
  });

  describe("brace expansion nested", () => {
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

  test("brace expansion in command", () => {
    const buffer = new Uint8Array(512);
    const result = $`{echo,a,b,c} {d,e,f} > ${buffer}`;
    const sentinel = sentinelByte(buffer);
    expect(new TextDecoder().decode(buffer.slice(0, sentinel))).toEqual("a b c d e f\n");
  });
});

function sentinelByte(buf: Uint8Array): number {
  for (let i = 0; i < buf.byteLength; i++) {
    if (buf[i] == 0) return i;
  }
  throw new Error("No sentinel byte");
}
