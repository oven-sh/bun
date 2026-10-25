import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unsupported } from "../aot/run-programs";
import { canTrim, getMappedSegments } from "./compile-trim-features";

const keyWidth = 8;
const base = 16777619;
let topPower = 1;
for (let i = 1; i < keyWidth; i++) topPower = Math.imul(topPower, base);

function keyAt(bytes: Uint8Array, at: number) {
  let key = 0;
  for (let i = 0; i < keyWidth; i++) key = (Math.imul(key, base) + bytes[at + i]!) | 0;
  return key;
}

function textsFoundIn(haystacks: Uint8Array[], texts: string[]): string[] {
  const needles = [...new Set(texts)].map(text => Buffer.from(text)).filter(needle => needle.length >= keyWidth);
  const maybe = new Uint8Array(1 << 24);
  const byKey = new Map<number, Buffer[]>();
  for (const needle of needles) {
    const key = keyAt(needle, 0);
    maybe[key >>> 8] = 1;
    byKey.set(key, [...(byKey.get(key) ?? []), needle]);
  }
  const found = new Set<string>();
  for (const haystack of haystacks) {
    if (haystack.length < keyWidth) continue;
    let key = keyAt(haystack, 0);
    for (let at = 0; ; at++) {
      if (maybe[key >>> 8]) {
        for (const needle of byKey.get(key) ?? []) {
          if (at + needle.length <= haystack.length && needle.equals(haystack.subarray(at, at + needle.length)))
            found.add(needle.toString());
        }
      }
      if (at + keyWidth >= haystack.length) break;
      key = (Math.imul(key - Math.imul(haystack[at]!, topPower), base) + haystack[at + keyWidth]!) | 0;
    }
  }
  return [...found].sort();
}

function endOfZstdFrame(bytes: Uint8Array, start: number): number | undefined {
  const descriptor = bytes[start + 4]!;
  const isSingleSegment = (descriptor >> 5) & 1;
  const contentSizeBytes = descriptor >> 6 === 0 ? isSingleSegment : [0, 2, 4, 8][descriptor >> 6]!;
  let at = start + 5 + (isSingleSegment ? 0 : 1) + [0, 1, 2, 4][descriptor & 3]! + contentSizeBytes;
  for (;;) {
    if (at + 3 > bytes.length) return undefined;
    const header = bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);
    const kind = (header >> 1) & 3;
    if (kind === 3) return undefined;
    at += 3 + (kind === 1 ? 1 : header >> 3);
    if (header & 1) break;
  }
  at += (descriptor >> 2) & 1 ? 4 : 0;
  return at <= bytes.length ? at : undefined;
}

function whatIsCompressedIn(bytes: Buffer): Uint8Array[] {
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const contents: Uint8Array[] = [];
  let position = bytes.indexOf(magic);
  while (position !== -1) {
    const end = endOfZstdFrame(bytes, position);
    if (end !== undefined) {
      try {
        contents.push(Bun.zstdDecompressSync(bytes.subarray(position, end)));
      } catch {}
    }
    position = bytes.indexOf(magic, position + 1);
  }
  return contents;
}

const heldByWhatStays = ["exhaustive-deps", "rules-of-hooks", "use-memo", "Substitutions for pattern "];
const stillLeftOnLinux = [
  "error-message",
  "no-console",
  "no-deprecated",
  "no-export",
  "no-proto",
  "plicit-function-",
  "prop-types",
];
const stillLeftOnMacOS = `
  activedescendant alt-text arrow-body-style bad-min-max-func block-scoped-var catch-error-name error-boundaries error-message
  fenced-code-meta forbid-dom-props id-match iframe-has-title inline-script-id jsx-indent jsx-indent-props max-dependencies max-nested-calls
  new-for-builtins no-absolute-path no-alert no-alias-methods no-array-reverse no-await-in-loop no-cast-to-brand no-children-prop no-clone-element
  no-console no-control-regex no-cycle no-deprecated no-done-callback no-empty no-empty-pattern no-export no-extend-native no-find-dom-node
  no-focused-tests no-global-assign no-hooks no-import-assign no-magic-numbers no-named-default no-octal no-proto no-return-assign no-setter-return
  no-sparse-arrays no-test-prefixes no-throw-literal no-typos no-undef no-unsafe no-unsafe-return no-unsafe-values no-unused-labels no-useless-catch
  object-shorthand only-throw-error plicit-function- prefer-es6-class prop-types require-alt-text rule-suppression
`
  .trim()
  .split(/\s+/);

function notAccountedFor(found: string[]) {
  if (isWindows && found.length > 0) console.error("left in the file:", found.join(" | "));
  return found
    .filter(
      text =>
        !isWindows &&
        !heldByWhatStays.includes(text) &&
        !(isMacOS && stillLeftOnMacOS.includes(text)) &&
        !(isLinux && stillLeftOnLinux.includes(text)),
    )
    .slice(0, 40);
}

const piecesOf = (name: string, width: number) =>
  name.length < width ? [name] : Array.from({ length: name.length - width + 1 }, (_, at) => name.slice(at, at + width));

const builtinModulesMagic = "BUNBLTNS";
const builtinModulesHeaderSize = 48;
const builtinModuleRecordSize = 24;

function readBuiltinSourceTexts(executable: Buffer): { name: string; text: string }[] {
  for (
    let start = executable.indexOf(builtinModulesMagic);
    start !== -1;
    start = executable.indexOf(builtinModulesMagic, start + 1)
  ) {
    if (start + builtinModulesHeaderSize > executable.length) break;
    const field = (index: number) => executable.readUInt32LE(start + builtinModulesMagic.length + index * 4);
    const header = {
      version: field(0),
      moduleCount: field(2),
      modulesOffset: field(3),
      dataOffset: field(6),
      dataLength: field(7),
    };
    if (header.version !== 2 || header.modulesOffset !== builtinModulesHeaderSize) continue;
    if (header.modulesOffset + header.moduleCount * builtinModuleRecordSize > header.dataOffset) continue;
    if (start + header.dataOffset + header.dataLength > executable.length) continue;
    const data = executable.subarray(start + header.dataOffset, start + header.dataOffset + header.dataLength);
    const textAt = (offset: number, length: number) => data.toString("latin1", offset, offset + length);
    const modules = Array.from({ length: header.moduleCount }, (_, index) => {
      const word = (position: number) =>
        executable.readUInt32LE(start + header.modulesOffset + index * builtinModuleRecordSize + position * 4);
      return { name: textAt(word(0), word(1)), codeOffset: word(4), codeLength: word(5) };
    });
    const functionsLength = Math.min(...modules.map(module => module.codeOffset)) - 1;
    return [
      { name: "built-in functions", text: textAt(0, functionsLength) },
      ...modules.map(module => ({ name: module.name, text: textAt(module.codeOffset, module.codeLength) })),
    ];
  }
  return [];
}

function samplePieces(text: string) {
  const width = 64;
  const stride = 512;
  const pieces = [text.slice(0, width)];
  for (let at = stride; at + width <= text.length; at += stride) pieces.push(text.slice(at, at + width));
  return pieces;
}

function said(cmd: string[], cwd: string) {
  const { stdout, stderr, exitCode } = Bun.spawnSync({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  return { stdout: stdout.toString(), stderr: stderr.toString(), exitCode };
}

const programs = { "hello.ts": `console.log("hello world");` };
using dir = tempDir("compile-trim-runtime-texts", programs);
said([bunExe(), "build", "--compile", "--trim", "hello.ts", "--outfile", "hello"], String(dir));
const file = canTrim ? readFileSync(join(String(dir), "hello" + (isWindows ? ".exe" : ""))) : Buffer.alloc(0);
const listed = said([bunExe(), "lint", "--rules", "--format", "json"], String(dir)).stdout;

describe.skipIf(!canTrim)("an executable without the Bun command line holds none of its texts", () => {
  const whole = readFileSync(bunExe());
  const everythingIn = (bytes: Buffer) => [bytes, ...whatIsCompressedIn(bytes)];
  const trimmed = getMappedSegments(file).flatMap(everythingIn);

  interface Rule {
    id: string;
    value: string;
    aliases: string[];
    description: string;
    docs_url: string;
  }
  const rules: Rule[] = JSON.parse(listed);

  test("the search finds them in the whole Bun", () => {
    const names = rules.map(rule => rule.value).filter(name => name.length >= 16);
    expect(names.length).toBeGreaterThan(100);
    const everything = everythingIn(whole);
    expect(textsFoundIn(everything, names).length).toBe(new Set(names).size);
    const descriptions = rules.map(rule => rule.description).filter(Boolean);
    expect(textsFoundIn(everything, descriptions).length).toBe(new Set(descriptions).size);
  });

  test("no name of a lint rule, and no sixteen bytes of one", () => {
    const names = rules
      .flatMap(rule => [rule.value, ...rule.aliases.map(alias => alias.slice(alias.indexOf("/") + 1))])
      .filter(name => name.includes("-"));
    expect(
      notAccountedFor(
        textsFoundIn(
          trimmed,
          names.flatMap(name => piecesOf(name, 16)),
        ),
      ),
    ).toEqual([]);
  });

  test("no description of a lint rule and no address of its page", () => {
    expect(
      notAccountedFor(textsFoundIn(trimmed, [...rules.map(rule => rule.description), "docs/lint/rules/"])),
    ).toEqual([]);
  });

  test("no message of a lint rule", () => {
    const reports: Record<string, Record<string, [number, number, number, number, string][]>> = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "..", "docs", "lint", "rules", "reports.json"), "utf8"),
    );
    const messages = [
      ...new Set(
        Object.values(reports).flatMap(examples =>
          Object.values(examples).flatMap(reported => reported.map(report => report[4])),
        ),
      ),
    ].filter(message => message.length >= 40);
    expect(messages.length).toBeGreaterThan(1000);
    const piecesAtWords = (message: string) =>
      piecesOf(message, 24).filter((_, at) => at === 0 || message[at - 1] === " ");
    const mostlyIn = (haystacks: Uint8Array[]) => {
      const found = new Set(textsFoundIn(haystacks, messages.flatMap(piecesAtWords)));
      return messages.filter(
        message =>
          piecesAtWords(message).filter(piece => found.has(piece)).length >= piecesAtWords(message).length * 0.8,
      );
    };
    expect(mostlyIn(everythingIn(whole)).length).toBeGreaterThan(messages.length / 3);
    expect(notAccountedFor(mostlyIn(trimmed))).toEqual([]);
  });

  test("no message of the type checker", () => {
    const messages = readFileSync(join(import.meta.dir, "..", "..", "src", "sema", "messages.txt"), "utf8")
      .split("\n")
      .flatMap(line => (line.split("\t")[2] ?? "").split(/'?\{\d+\}'?/))
      .filter(piece => piece.length >= 24);
    expect(messages.length).toBeGreaterThan(500);
    expect(notAccountedFor(textsFoundIn(trimmed, messages))).toEqual([]);
  });

  (unsupported ? test.skip : test.todoIf(isWindows))(
    "no source text of the built-in modules in a compiled program that cannot run a string as code",
    () => {
      const sources = readBuiltinSourceTexts(whole);
      expect(sources.length).toBeGreaterThan(100);
      const mostlyIn = (haystacks: Uint8Array[]) => {
        const found = new Set(
          textsFoundIn(
            haystacks,
            sources.flatMap(source => samplePieces(source.text)),
          ),
        );
        return sources
          .filter(
            source =>
              samplePieces(source.text).filter(piece => found.has(piece)).length * 2 >=
              samplePieces(source.text).length,
          )
          .map(source => source.name);
      };
      expect(mostlyIn(trimmed)).toEqual(sources.map(source => source.name));
      using dir = tempDir("compile-trim-runtime-texts-compiled", programs);
      const folder = String(dir);
      const compiled = said(
        [
          bunExe(),
          "build",
          "--compile",
          "--aot",
          "--trim",
          "--disallow-code-generation-from-strings",
          "hello.ts",
          "--outfile",
          "compiled",
        ],
        folder,
      );
      expect(compiled.exitCode).toBe(0);
      expect(mostlyIn(everythingIn(readFileSync(join(folder, "compiled" + (isWindows ? ".exe" : "")))))).toEqual([]);
      expect(said([join(folder, "compiled")], folder)).toEqual({ stdout: "hello world\n", stderr: "", exitCode: 0 });
    },
  );
});
