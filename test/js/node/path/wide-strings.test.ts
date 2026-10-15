import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { mkdirSync } from "node:fs";
import path from "node:path";

// The same characters in a string of 16-bit units: a slice of a string that holds a character beyond Latin-1.
const wide = (text: string): string => ("\u0100" + text).slice(1);

const pieces = ["a", "bc", "def", ".", "..", "", "/", "//", "\\", "\\\\", "./", "../", ".\\", "..\\", "a/b", "a\\b", "/a", "\\a", "b/", "b\\", "...", ".a", "a.", "..a", "a..", " ", "C:", "c:", "C:\\", "C:/", "D:", "\\\\server\\share", "//server/share", "\\\\?\\C:\\", "\\\\.\\pipe", "x.y.z", ".ts", "index.ts", "CON", "a:b", "%2e"];
let seed = 4242;
const next = (n: number) => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) >>> 8) % n;
function generated(): string {
  let text = "";
  for (let k = next(7); k > 0; k--) {
    text += pieces[next(pieces.length)];
    if (next(3) === 0) text += next(2) === 0 ? "/" : "\\";
  }
  return text;
}

for (const [flavor, implementation] of [
  ["posix", path.posix],
  ["win32", path.win32],
] as const) {
  test(`path.${flavor} answers the same for 8-bit and 16-bit strings of the same characters`, () => {
    const differences: string[] = [];
    const same = (name: string, args: string[]) => {
      const f = (implementation as any)[name];
      const narrow = JSON.stringify(f(...args));
      for (let mask = 1; mask < 1 << args.length; mask++) {
        const answer = JSON.stringify(f(...args.map((arg, i) => (mask & (1 << i) ? wide(arg) : arg))));
        if (answer !== narrow && differences.length < 10) differences.push(`${name}(${JSON.stringify(args)}) [${mask}]: ${answer}, 8-bit: ${narrow}`);
      }
    };
    for (let round = 0; round < 20000; round++) {
      const p = generated();
      const q = generated();
      for (const name of ["parse", "normalize", "isAbsolute", "dirname", "basename", "extname", "resolve", "join", "toNamespacedPath"]) same(name, [p]);
      for (const name of ["resolve", "join", "relative", "basename"]) same(name, [p, q]);
      same("basename", [p, p.slice(next(p.length + 1))]);
      same("join", [p, q, generated()]);
      same("resolve", [p, q, generated()]);
    }
    expect(differences).toEqual([]);
  });
}

test("path.win32 keeps what is not ASCII", () => {
  const { win32 } = path;
  expect(win32.basename("C:\\é\\日本.ts", ".ts")).toBe("日本");
  expect(win32.basename("C:\\a\\éé.é", ".é")).toBe("éé");
  expect(win32.dirname("C:\\\ud800\\b")).toBe("C:\\\ud800");
  expect(win32.normalize("C:/\udc00/../\ud800/x")).toBe("C:\\\ud800\\x");
  expect(win32.join("C:\\a", "\ud800", "..", "日本")).toBe("C:\\a\\日本");
  expect(win32.relative("C:\\a\\\ud800", "C:\\a\\\udc00")).toBe("..\\\udc00");
  expect(win32.extname("C:\\a\\x.\ud800")).toBe(".\ud800");
  expect(win32.parse("C:\\é\\\ud800.日本")).toEqual({ root: "C:\\", dir: "C:\\é", base: "\ud800.日本", ext: ".日本", name: "\ud800" });
  expect(win32.resolve("C:\\a", "é", "\ud800")).toBe("C:\\a\\é\\\ud800");
});

for (const [flavor, implementation] of [
  ["posix", path.posix],
  ["win32", path.win32],
] as const) {
  for (const [kind, letter] of [
    ["beyond Latin-1", "日"],
    ["of Latin-1", "é"],
    ["that is a lone surrogate", "\ud800"],
  ] as const) {
    test(`to path.${flavor} a letter ${kind} is a letter like any other`, () => {
      const differences: string[] = [];
      const replaced = (text: string) => text.replaceAll("q", letter);
      const words = ["q", "qq", "aq", "q.q", ".q", "q.", "q q", "..q", "q.ts", ...pieces.filter(piece => !piece.includes(":"))];
      const written = (): string => {
        let text = ["", "", "/", "\\", "C:\\", "c:/", "C:", "\\\\server\\share\\"][next(8)]!;
        for (let k = next(6); k > 0; k--) {
          text += words[next(words.length)];
          if (next(3) !== 0) text += next(2) === 0 ? "/" : "\\";
        }
        return text;
      };
      const same = (name: string, args: string[]) => {
        const f = (implementation as any)[name];
        const answer = f(...args);
        const expected = JSON.stringify(typeof answer === "string" ? replaced(answer) : typeof answer === "object" ? Object.fromEntries(Object.entries<string>(answer).map(([key, value]) => [key, replaced(value)])) : answer);
        const actual = JSON.stringify(f(...args.map(replaced)));
        if (actual !== expected && differences.length < 10) differences.push(`${name}(${JSON.stringify(args.map(replaced))}): ${actual}, by the ASCII letter: ${expected}`);
      };
      for (let round = 0; round < 10000; round++) {
        const p = written();
        const q = written();
        for (const name of ["parse", "normalize", "isAbsolute", "dirname", "basename", "extname", "join"]) same(name, [p]);
        for (const name of ["join", "basename"]) same(name, [p, q]);
        same("basename", [p, p.slice(next(p.length + 1))]);
        same("join", [p, q, written()]);
        const root = flavor === "win32" ? "C:\\r\\" : "/r/";
        same("resolve", [root, p, q]);
        same("relative", [root + p.replaceAll(":", ""), root + q.replaceAll(":", "")]);
      }
      expect(differences).toEqual([]);
    });
  }
}

test("the working directory may hold what is not ASCII", () => {
  using folder = tempDir("path-working-directory", {});
  const inside = path.join(String(folder), "é日本");
  mkdirSync(inside);
  const program = `
    const path = require("node:path");
    if (process.argv[1]) process.chdir(process.argv[1]);
    const cwd = process.cwd();
    console.log(JSON.stringify([
      cwd.normalize("NFC").endsWith("é日本"),
      path.resolve("ü") === cwd + "/ü",
      path.resolve("a") === cwd + "/a",
      path.resolve() === cwd,
      path.resolve("ü", "..") === cwd,
      path.resolve("\\ud800") === cwd + "/\\ud800",
      path.relative("ü", "ö"),
      path.relative("ü", cwd),
      path.relative(cwd, "ü/日"),
      path.relative("/", "ü") === cwd.slice(1) + "/ü",
    ]));`;
  const expected = JSON.stringify([true, true, true, true, true, true, "../ö", "..", "ü/日", true]);
  for (const [cwd, args] of [
    [inside, []],
    [String(folder), [inside]],
  ] as const) {
    const { stdout, stderr, exitCode } = Bun.spawnSync({ cmd: [bunExe(), "-e", program, ...args], cwd, env: bunEnv });
    expect({ stdout: stdout.toString().trim(), stderr: stderr.toString(), exitCode }).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
  }
});
