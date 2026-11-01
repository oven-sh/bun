// A regular expression literal that the engine's parser refuses is an error of the build, whether or not anything reads the literal.
// What is only unusual (`/\1/`, `/{/`, `/\p{L}/` without a flag) is a program.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./with-compiler";

const literals = [
  String.raw`/(/`,
  String.raw`/)/`,
  String.raw`/[/`,
  String.raw`/]/`,
  String.raw`/]/u`,
  String.raw`/}/`,
  String.raw`/}/u`,
  String.raw`/{/`,
  String.raw`/{/u`,
  String.raw`/{1}/`,
  String.raw`/a{1/`,
  String.raw`/a{1/u`,
  String.raw`/[b-a]/`,
  String.raw`/a**/`,
  String.raw`/a***/`,
  String.raw`/a+*/`,
  String.raw`/*/`,
  String.raw`/+/`,
  String.raw`/?/`,
  String.raw`/a|*/`,
  String.raw`/(?:*)/`,
  String.raw`/^*/`,
  String.raw`/$*/`,
  String.raw`/\b*/`,
  String.raw`/a{2,1}/`,
  String.raw`/a{2,1}?/`,
  String.raw`/a{1,2}{3}/`,
  String.raw`/(?<n>a)(?<n>b)/`,
  String.raw`/(?<n>a)|(?<n>b)/`,
  String.raw`/(?:(?<n>a)|(?<n>b))(?<n>c)/`,
  String.raw`/(?<n>a)(?:b|(?<n>c))/`,
  String.raw`/(?<>a)/`,
  String.raw`/(?<1>a)/`,
  String.raw`/(?<a-b>a)/`,
  String.raw`/(?<a/`,
  String.raw`/(?<𝒜>.)/`,
  String.raw`/(?<\u{1d49c}>.)/`,
  String.raw`/(?<a\u{110000}>.)/`,
  String.raw`/\k<x>/`,
  String.raw`/\k<x>/u`,
  String.raw`/\k/`,
  String.raw`/\k/u`,
  String.raw`/\k<x>(?<y>a)/`,
  String.raw`/\k<x(?<x>a)/`,
  String.raw`/\k(?<x>a)/`,
  String.raw`/\k<x>(?<x>a)/`,
  String.raw`/\1(a)/`,
  String.raw`/\2(a)/`,
  String.raw`/\2(a)/u`,
  String.raw`/\1/u`,
  String.raw`/\4/`,
  String.raw`/\4/u`,
  String.raw`/\8/`,
  String.raw`/\8/u`,
  String.raw`/\00/`,
  String.raw`/\00/u`,
  String.raw`/\0/u`,
  String.raw`/[\1]/`,
  String.raw`/[\1]/u`,
  String.raw`/[\00]/u`,
  String.raw`/\u{110000}/u`,
  String.raw`/\u{110000}/`,
  String.raw`/\u{}/u`,
  String.raw`/\u/u`,
  String.raw`/\u/`,
  String.raw`/\u12/u`,
  String.raw`/\x/u`,
  String.raw`/\x1/u`,
  String.raw`/\x1/`,
  String.raw`/\p{Foo}/u`,
  String.raw`/\p{Foo}/`,
  String.raw`/\p{L}/u`,
  String.raw`/\p{Script=Greek}/u`,
  String.raw`/\p{Script=Foo}/u`,
  String.raw`/\p{Script}/u`,
  String.raw`/\p{L/u`,
  String.raw`/\p/u`,
  String.raw`/\P{Any}/u`,
  String.raw`/\p{RGI_Emoji}/u`,
  String.raw`/\p{RGI_Emoji}/v`,
  String.raw`/\P{RGI_Emoji}/v`,
  String.raw`/[^\p{RGI_Emoji}]/v`,
  String.raw`/[\d-a]/`,
  String.raw`/[\d-a]/u`,
  String.raw`/[a-\d]/u`,
  String.raw`/[\d-\w]/u`,
  String.raw`/\c/`,
  String.raw`/\c/u`,
  String.raw`/\c1/u`,
  String.raw`/[\c]/u`,
  String.raw`/\cA/u`,
  String.raw`/\-/`,
  String.raw`/\-/u`,
  String.raw`/[\-]/u`,
  String.raw`/\a/u`,
  String.raw`/\_/u`,
  String.raw`/\//u`,
  String.raw`/(?=a)+/`,
  String.raw`/(?=a)+/u`,
  String.raw`/(?!a)*/u`,
  String.raw`/(?<=a)+/`,
  String.raw`/(?<!a)*/`,
  String.raw`/(?<=a)+/u`,
  String.raw`/(?a)/`,
  String.raw`/(?/`,
  String.raw`/(?i:a)/`,
  String.raw`/(?-i:a)/`,
  String.raw`/(?i-s:a)/`,
  String.raw`/(?i-i:a)/`,
  String.raw`/(?ii:a)/`,
  String.raw`/(?-:a)/`,
  String.raw`/(?g:a)/`,
  String.raw`/(?i-:a)/`,
  String.raw`/(?ims-:a)/`,
  String.raw`/a/gg`,
  String.raw`/a/x`,
  String.raw`/a/uv`,
  String.raw`/a/G`,
  String.raw`/a/g`,
  String.raw`/a/dgimsuy`,
  String.raw`/a/dgimsvy`,
  String.raw`/[a&&&b]/v`,
  String.raw`/[a&&b]/v`,
  String.raw`/[a--b]/v`,
  String.raw`/[a--b&&c]/v`,
  String.raw`/[a&&b--c]/v`,
  String.raw`/[ab--c]/v`,
  String.raw`/[(]/v`,
  String.raw`/[(]/u`,
  String.raw`/[)]/v`,
  String.raw`/[{]/v`,
  String.raw`/[|]/v`,
  String.raw`/[/]/v`,
  String.raw`/[-]/v`,
  String.raw`/[a-]/v`,
  String.raw`/[!!]/v`,
  String.raw`/[a!!b]/v`,
  String.raw`/[\q{abc|d}]/v`,
  String.raw`/[^\q{abc}]/v`,
  String.raw`/[^\q{a}]/v`,
  String.raw`/\q{a}/v`,
  String.raw`/[[a-z]--[aeiou]]/v`,
  String.raw`/[[a]/v`,
  String.raw`/[z-a]/v`,
  String.raw`/[\b]/`,
  String.raw`/[\B]/u`,
  String.raw`/[\B]/`,
  String.raw`/(?:)/`,
  String.raw`/\/`,
  String.raw`/😀{2}/u`,
  String.raw`/[😀-😁]/u`,
  String.raw`/[\ude00-\ud83d]/`,
  String.raw`/[😁-😀]/u`,
  String.raw`/[😁-😀]/`,
  String.raw`/a{99999999999999999999}/`,
  String.raw`/a{99999999999999999999,1}/`,
  String.raw`/\99999999999999999999/`,
];

// Where a literal stands that nothing reads.
const places: [string, (literal: string) => string][] = [
  ["a variable", literal => `var r = ${literal};\n`],
  ["a function that nobody calls", literal => `function unused() { return ${literal}; }\n`],
  [
    "a branch that is only known at run time not to be taken",
    literal => `if (process.argv.length > 99) console.log(${literal});\n`,
  ],
  ["the default of a parameter", literal => `export function f(a = ${literal}) { return 1; }\n`],
  ["a field of a class that nobody constructs", literal => `class C { r = ${literal}; }\n`],
];

function isRefusedByTheEngine(literal: string) {
  try {
    new Function(`return ${literal};`);
    return false;
  } catch {
    return true;
  }
}

test.each(["js", "ts"])("the files that the engine refuses are errors, and no other: .%s", extension => {
  const files: Record<string, string> = {};
  const refused: string[] = [];
  literals.forEach((literal, index) => {
    const [, write] = places[index % places.length];
    const name = `c${index}.${extension}`;
    // TypeScript has more to say of a pattern than the language, where it is asked.
    files[name] = (extension === "ts" ? "// @ts-nocheck\n" : "") + write(literal) + "export {};\n";
    if (isRefusedByTheEngine(literal)) refused.push(name);
  });
  const names = Object.keys(files);
  files[`main.${extension}`] = names.map(name => `import "./${name}";\n`).join("") + "console.log(1);\n";
  if (extension === "ts")
    files["tsconfig.json"] = JSON.stringify({ compilerOptions: { allowImportingTsExtensions: true, noEmit: true } });
  using dir = tempDir("aot-regexp-literals", files);
  const { stdout, exitCode, signalCode } = Bun.spawnSync({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", `main.${extension}`],
    cwd: String(dir),
    env: bunEnv,
    stderr: "ignore",
  });
  const reported = new Set(
    [...stdout.toString().matchAll(/^(c\d+\.[jt]s)\(\d+,\d+\): error TS/gm)].map(match => match[1]),
  );
  expect(refused.length).toBeGreaterThan(80);
  expect(names.length - refused.length).toBeGreaterThan(40);
  expect({ reported: names.filter(name => reported.has(name)), exitCode, signalCode }).toEqual({
    reported: refused,
    exitCode: 1,
    signalCode: undefined,
  });
});
