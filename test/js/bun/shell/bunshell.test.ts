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

  test("pipeline", () => {});
});

function sentinelByte(buf: Uint8Array): number {
  for (let i = 0; i < buf.byteLength; i++) {
    if (buf[i] == 0) return i;
  }
  throw new Error("No sentinel byte");
}
