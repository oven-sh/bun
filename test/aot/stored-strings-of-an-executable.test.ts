import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findImage, imageHeader } from "./cli/compiled-image";
import { run } from "./harness/run";
import { test } from "./supported";

// An image lays a text that is another's front, tail or inside in that other text, and a text of over 255 units has a record of another kind.
const holder = "a text that holds others of this program";
const texts = [
  holder,
  "a text that holds",
  "others of this program",
  "that holds others",
  "café au lait, déjà vu",
  "αβγ beside δεζ",
  "beside δεζ",
  "a long text 0123456789 ".repeat(20),
];

// A script reads these lines. Their words stay as they are for good: whoever changes them breaks that script.
const lineOnText = /^image (\d+) \| Text \| offset (\d+) \| length (\d+) \| (\d+) bytes that no string covers$/;
const lineOnOtherText =
  /^image (\d+) \| (quoted text|function text) \| offset (\d+) \| length (\d+) \| (\d+) bytes that no string covers$/;

const print = (directory: string, ...rest: string[]) =>
  run([bunExe(), "build", "--aot-stored-strings", ...rest], directory, bunEnv);
const linesOf = (text: string) => text.split("\n").filter(line => line !== "");

test("the strings that an executable stores are printed out of the finished file", async () => {
  using dir = tempDir("aot-stored-strings-of-an-executable", {
    "main.ts": texts.map(text => `console.log(${JSON.stringify(text)});\n`).join(""),
  });
  const directory = String(dir);
  const executable = join(directory, `main${isWindows ? ".exe" : ""}`);
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable], directory);
  expect(built.exitCode).toBe(0);
  expect((await run([executable], directory)).stdout).toBe(texts.map(text => text + "\n").join(""));

  const printed = await print(directory, executable);
  expect(printed.exitCode).toBe(0);
  const [onText, ...onOthers] = linesOf(printed.stderr);
  for (const line of onOthers) expect(line).toMatch(lineOnOtherText);
  const records = printed.stdout.split("\0");
  expect(records.pop()).toBe("");
  for (const text of texts) expect(records).toContain(text);
  const [, number, offset, length] = lineOnText.exec(onText)!.map(Number);
  expect(number).toBe(0);
  const file = readFileSync(executable);
  const at = file.indexOf(holder, offset, "latin1");
  expect(at >= offset && at + holder.length <= offset + length).toBeTrue();

  const changed = (name: string, change: (bytes: Buffer) => Buffer | void) => {
    const bytes = Buffer.from(file);
    writeFileSync(join(directory, name), change(bytes) ?? bytes);
    return print(directory, name);
  };
  expect(file[offset]).toBe(0);
  const withOtherByte = await changed("byte", bytes => void (bytes[offset] = 0x78));
  expect(withOtherByte.exitCode).toBe(1);
  expect(linesOf(withOtherByte.stderr)).toEqual([
    onText,
    `image 0 | Text | the byte at offset ${offset} is covered by no string and is not zero`,
    ...onOthers,
  ]);

  const version = file.readUInt32LE(findImage(file) + imageHeader.formatVersion);
  const ofOtherFormat = await changed(
    "format",
    bytes => void bytes.writeUInt32LE(version + 1, findImage(file) + imageHeader.formatVersion),
  );
  expect({ ...ofOtherFormat, stderr: linesOf(ofOtherFormat.stderr) }).toEqual({
    exitCode: 2,
    stdout: "",
    stderr: [`image 0 | this Bun reads format ${version}; the image says ${version + 1}`],
  });

  const room = Buffer.alloc((16384 - (file.length % 16384)) % 16384);
  const twice = await changed("twice", bytes => Buffer.concat([bytes, room, bytes]));
  expect(twice.exitCode).toBe(0);
  expect(twice.stdout).toBe(printed.stdout + printed.stdout);
  const onTextTwice = linesOf(twice.stderr).filter(line => lineOnText.test(line));
  expect(onTextTwice.map(line => lineOnText.exec(line)!.slice(1, 4).map(Number))).toEqual([
    [0, offset, length],
    [1, file.length + room.length + offset, length],
  ]);

  const withoutImage = await changed("none", bytes => bytes.subarray(0, findImage(file)));
  expect({ ...withoutImage, stderr: linesOf(withoutImage.stderr) }).toEqual({
    exitCode: 2,
    stdout: "",
    stderr: ["the file holds no image"],
  });

  const missing = await print(directory, "no-such-file");
  expect({ exitCode: missing.exitCode, stdout: missing.stdout }).toEqual({ exitCode: 2, stdout: "" });
  expect(missing.stderr).toContain('--aot-stored-strings: failed to read "no-such-file": ENOENT');

  for (const more of [["--minify"], ["main.ts"]]) {
    const refused = await print(directory, executable, ...more);
    expect({ exitCode: refused.exitCode, stdout: refused.stdout }).toEqual({ exitCode: 2, stdout: "" });
    expect(refused.stderr).toContain("--aot-stored-strings takes a finished executable and nothing else");
  }
}, 240_000);

test("the text of a function and the text that an error quotes are printed too", async () => {
  using dir = tempDir("aot-stored-strings-beside-the-section-of-text", {
    "main.ts": `
      function shownAsText(left: number, right: number) {
        return left + right + " kept with its text";
      }
      console.log(JSON.stringify(String(shownAsText)));
      const holdsNothing: any = {};
      try {
        holdsNothing.memberThatIsMissing.calledAnyway();
      } catch (error) {
        console.log(JSON.stringify((error as Error).message));
      }
    `,
  });
  const directory = String(dir);
  const executable = join(directory, `main${isWindows ? ".exe" : ""}`);
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable], directory);
  expect(built.exitCode).toBe(0);
  const [functionSource, message] = linesOf((await run([executable], directory)).stdout).map(line => JSON.parse(line));
  expect(functionSource).toContain("kept with its text");
  const quoted = /evaluating '(.+)'/.exec(message)![1];
  expect(quoted).toBe("holdsNothing.memberThatIsMissing.calledAnyway");

  const printed = await print(directory, executable);
  expect(printed.exitCode).toBe(0);
  const records = printed.stdout.split("\0");
  expect(records).toContain(functionSource);
  expect(records).toContain(quoted);
  const file = readFileSync(executable);
  const [onText, ...onOthers] = linesOf(printed.stderr);
  expect(onText).toMatch(lineOnText);
  expect(onOthers.map(line => lineOnOtherText.exec(line)![2])).toEqual(["quoted text", "function text"]);
  for (const [index, text] of [quoted, functionSource].entries()) {
    const [, , , offset, length, beside] = lineOnOtherText.exec(onOthers[index])!.map(Number);
    const at = file.indexOf(text, offset, "utf8");
    // A text lies in its section as it is, or compressed, and then nowhere behind the start of the section.
    expect({ text, isInside: at < 0 || (at >= offset && at + Buffer.byteLength(text) <= offset + length) }).toEqual({
      text,
      isInside: true,
    });
    expect(beside).toBe(0);
  }
}, 240_000);
