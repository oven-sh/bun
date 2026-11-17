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

// The command takes no other flag, not from the environment either.
const { BUN_OPTIONS: _, ...env } = bunEnv;
const print = (directory: string, ...rest: string[]) =>
  run([bunExe(), "build", "--aot-stored-strings", ...rest], directory, env);
const linesOf = (text: string) => text.split("\n").filter(line => line !== "");

interface Range {
  type: "image" | "section" | "string" | "uncovered";
  image: number;
  section: string;
  offset: number;
  length: number;
  encoding: "latin1" | "utf16le" | "utf8" | "coded";
  text: string;
  isZero: boolean;
}

async function printRanges(directory: string, executable: string) {
  const printed = await run([bunExe(), "build", "--aot-stored-strings-json", executable], directory, env);
  return { ...printed, ranges: linesOf(printed.stdout).map((line): Range => JSON.parse(line)) };
}

/** Fails unless each byte of a section is in strings, or in one uncovered run. */
function expectEveryByteIsCovered(ranges: Range[], file: Buffer) {
  const sections = ranges
    .filter(range => range.type === "section")
    .map(section => ({ ...section, coverage: new Uint8Array(section.length) }));
  for (const { type, section, offset, length, isZero } of ranges) {
    if (type !== "string" && type !== "uncovered") continue;
    const holder = sections.find(it => offset >= it.offset && offset + length <= it.offset + it.length)!;
    expect({ section: holder.section, isEmpty: length === 0 }).toEqual({ section, isEmpty: false });
    const begin = offset - holder.offset;
    if (type === "string") {
      for (let at = begin; at < begin + length; at++) holder.coverage[at] |= 1;
      continue;
    }
    for (let at = begin; at < begin + length; at++) holder.coverage[at] += 2;
    expect(file.subarray(offset, offset + length).every(byte => byte === 0)).toBe(isZero);
  }
  for (const { section, coverage } of sections) {
    expect({ section, isPartition: coverage.every(it => it === 1 || it === 2) }).toEqual({
      section,
      isPartition: true,
    });
  }
}

/** The characters of a string as they are in the file, or null if they are coded. */
function readCharacters(file: Buffer, { offset, length, encoding }: Range) {
  return encoding === "coded" ? null : file.toString(encoding, offset, offset + length);
}

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

test("the strings are printed with their places in the file as lines of JSON", async () => {
  using dir = tempDir("aot-places-of-stored-strings", {
    "main.ts": `
      function describe(left: number, right: number) {
        return left + right + " kept with its text";
      }
      const holdsNothing: any = {};
      try {
        holdsNothing.memberThatIsMissing.calledAnyway();
      } catch (error) {
        console.log(String(describe).length > 0, String((error as Error).message).length > 0);
      }
      ${texts.map(text => `console.log(${JSON.stringify(text)});\n`).join("")}
      console.log("\\ud800 alone".length);
      console.log(["\\ud800 alone"]);
    `,
  });
  const directory = String(dir);
  const executable = join(directory, `main${isWindows ? ".exe" : ""}`);
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable], directory);
  expect(built.exitCode).toBe(0);

  const file = readFileSync(executable);
  const printed = await print(directory, executable);
  const { ranges, ...json } = await printRanges(directory, executable);
  expect({ stderr: json.stderr, exitCode: json.exitCode }).toEqual({ stderr: printed.stderr, exitCode: 0 });
  const records = printed.stdout.split("\0");
  expect(records.pop()).toBe("");
  const strings = ranges.filter(range => range.type === "string");
  // UTF-8 has no lone surrogates. JSON has.
  expect(strings.map(({ text }, index) => (text.isWellFormed() ? text : records[index]))).toEqual(records);
  expect(strings.map(({ text }) => text)).toContain("\ud800 alone");

  const [onText] = linesOf(printed.stderr);
  const [, number, offset, length] = lineOnText.exec(onText)!.map(Number);
  expect(ranges[0]).toMatchObject({ type: "image", image: 0, offset: findImage(file) });
  expect(ranges[1]).toEqual({ type: "section", image: number, section: "Text", offset, length } as Range);
  expect(ranges.filter(range => range.type === "section").map(range => range.section)).toEqual([
    "Text",
    "coded text",
    "quoted text",
    "function text",
  ]);
  expectEveryByteIsCovered(ranges, file);
  for (const range of strings) expect(readCharacters(file, range) ?? range.text).toBe(range.text);
  for (const text of texts) {
    const { section, encoding } = strings.find(range => range.text === text)!;
    expect({ text, section, encoding }).toEqual({
      text,
      section: "Text",
      encoding: /[^\0-\xff]/.test(text) ? "utf16le" : "latin1",
    });
  }
  const coded = strings.filter(range => range.section === "coded text");
  expect(coded.length).toBeGreaterThan(0);
  expect(coded.every(range => range.encoding === "coded")).toBeTrue();

  expect(file[offset]).toBe(0);
  const changed = Buffer.from(file);
  changed[offset] = 0x78;
  writeFileSync(join(directory, "changed"), changed);
  const ofChanged = await printRanges(directory, "changed");
  expect(ofChanged.exitCode).toBe(1);
  expectEveryByteIsCovered(ofChanged.ranges, changed);
  expect(ofChanged.ranges).toContainEqual(
    expect.objectContaining({ type: "uncovered", section: "Text", offset, isZero: false }),
  );

  const refused = await run([bunExe(), "build", "--aot-stored-strings-json", executable, "--minify"], directory, env);
  expect({ exitCode: refused.exitCode, stdout: refused.stdout }).toEqual({ exitCode: 2, stdout: "" });
  expect(refused.stderr).toContain("--aot-stored-strings-json takes a finished executable and nothing else");
}, 240_000);

// A switch and a comparison have the characters in the machine code, up to eight in an instruction. The image has no entry for them.
test("the metafile lists the strings that are in the machine code alone", async () => {
  const labels = ["aardvark", "bandicoot", "dik-dik", "wörterbuch", "ωμέγα"];
  const compared = ["q", "zq", "quokka", "quokka of Rottnest Island", "κακαποε"];
  const prefixes = ["\u{1f9a9} flamingo", "nu", "numbat", "numbat and a longer tail of it"];
  const parts = ["<li class=", "</li>"];
  const bytes = "okapi in a buffer";
  const folded = ["tapir", " in two parts"];
  const unreached = "a thylacine";
  const inlined = [
    "aardvark",
    "bandicoot",
    "dik-dik",
    "wörterbuch",
    "ωμέγα",
    "q",
    "zq",
    "quokka",
    "nu",
    "numbat",
    ...parts,
    bytes,
  ];
  const returns = (words: string[], test: (word: string) => string) =>
    words.map((word, index) => `if (${test(JSON.stringify(word))}) return ${index + 1};`).join("\n");
  using dir = tempDir("aot-inlined-strings", {
    "main.ts": `
      function choose(animal: string): number {
        switch (animal) {
          ${labels.map((word, index) => `case ${JSON.stringify(word)}: return ${index + 1};`).join("\n")}
        }
        return 0;
      }
      function compare(animal: unknown): number {
        ${returns(compared, word => `animal === ${word}`)}
        return animal === ${folded.map(part => JSON.stringify(part)).join(" + ")} ? 9 : 0;
      }
      function countPrefixes(animals: string[]): number {
        let sum = 0;
        for (const animal of animals) {
          if (typeof animal !== "string") continue;
          ${prefixes.map((word, index) => `if (animal.startsWith(${JSON.stringify(word)})) sum += ${index + 1};`).join("\n")}
        }
        return sum;
      }
      function render(items: string[]): string {
        let html = "";
        for (const item of items) html += \`${parts[0]}\${item}\${item.length}${parts[1]}\`;
        return html;
      }
      function unreached(animal: string): boolean {
        return animal === ${JSON.stringify(unreached)};
      }
      const animals = process.argv.slice(2);
      console.log(choose(animals[0] ?? ""), compare(animals[1]), Buffer.from(${JSON.stringify(bytes)}).length);
      console.log(countPrefixes(animals), render(animals).length);
    `,
  });
  const directory = String(dir);
  const executable = join(directory, `main${isWindows ? ".exe" : ""}`);
  const build = (...flags: string[]) =>
    run([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable, ...flags], directory);
  expect((await build()).exitCode).toBe(0);
  const file = readFileSync(executable);
  expect((await build("--metafile=meta.json")).exitCode).toBe(0);
  expect(readFileSync(executable).equals(file)).toBeTrue();
  expect((await run([executable, "ωμέγα", "quokka", "numbat"], directory)).stdout).toBe("5 3 17\n5 65\n");

  const { outputs } = JSON.parse(readFileSync(join(directory, "meta.json"), "utf8"));
  const [{ inlinedStrings }] = Object.values<{ inlinedStrings: string[] }>(outputs);
  expect(new Set(inlinedStrings).size).toBe(inlinedStrings.length);
  const { ranges } = await printRanges(directory, executable);
  // The source of a function has every string that the function has.
  const stored = new Set(ranges.filter(range => /^(Text|coded text)$/.test(range.section)).map(range => range.text));
  expect(inlinedStrings.filter(text => stored.has(text))).toEqual([]);
  const words = [...labels, ...compared, ...prefixes, ...parts, bytes, folded.join("")];
  expect(words.filter(word => !stored.has(word) && !inlinedStrings.includes(word))).toEqual([]);
  expect(inlined.filter(word => !inlinedStrings.includes(word))).toEqual([]);
  expect(stored.has(unreached) || inlinedStrings.includes(unreached)).toBeFalse();
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
    expect({ text, isInside: at >= offset && at + Buffer.byteLength(text) <= offset + length }).toEqual({
      text,
      isInside: true,
    });
    expect(beside).toBe(0);
  }
}, 240_000);
