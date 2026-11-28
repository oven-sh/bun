import { serialize } from "bun:jsc";
import { expect, test } from "bun:test";
import { isDebug, isWindows } from "harness";
import { posix, win32 } from "node:path";

// A string is serialized with one byte or two for each character, as it is held.
const isWide = (text: string) => serialize(text).byteLength > serialize("x".repeat(text.length)).byteLength;

// The result is 8-bit if the arguments are, and equals that of the same call with an ASCII letter in place of the character.
test.each([
  ["posix", posix],
  ["win32", win32],
])("%s: one character outside ASCII at every position of names of up to 100 characters", (_, path) => {
  const wrong: string[] = [];
  let withLetter: string[] = [];
  let withCharacter: string[] = [];
  function check(call: string, answer: string) {
    if (isWide(answer)) wrong.push(`${call}: ${JSON.stringify(answer)}`);
    withCharacter.push(answer.replaceAll("é", "x"));
  }
  // All lengths take a minute on a debug build.
  for (let length = 1; length <= 100; length += isDebug ? 9 : 1) {
    for (let position = -1; position < length; position++) {
      withCharacter = [];
      const plain = "x".repeat(length);
      const name = position < 0 ? plain : plain.slice(0, position) + "é" + plain.slice(position + 1);
      // A rope is not what the functions are given most of the time.
      const flat = (text: string) => Buffer.from(text, "latin1").toString("latin1");
      const at = `length ${length} position ${position}`;
      check(`dirname of the name ${at}`, path.dirname(flat(`/${name}/a`)));
      check(`dirname beside the name ${at}`, path.dirname(flat(`/${plain}/${name}`)));
      check(`basename of the name ${at}`, path.basename(flat(`/a/${name}`)));
      check(`basename beside the name ${at}`, path.basename(flat(`/${name}/${plain}`)));
      check(`basename without a suffix ${at}`, path.basename(flat(`/a/${name}.txt`), ".txt"));
      check(`extname of the name ${at}`, path.extname(flat(`/a/b.${name}`)));
      check(`extname beside the name ${at}`, path.extname(flat(`/${name}/b.${plain}`)));
      check(`normalize a tidy path ${at}`, path.normalize(flat(`/a/${name}`)));
      check(`normalize an untidy path ${at}`, path.normalize(flat(`/a/./${name}`)));
      check(`normalize the name away ${at}`, path.normalize(flat(`/a/${name}/../${plain}`)));
      check(`join ${at}`, path.join("/a", flat(name), "b"));
      check(`join one ${at}`, path.join(flat(`/${name}`)));
      check(`join upwards ${at}`, path.join("/a", flat(`../${name}`)));
      check(`resolve ${at}`, path.resolve(flat(`/${name}`)));
      check(`resolve two ${at}`, path.resolve("/a", flat(name)));
      check(`resolve upwards ${at}`, path.resolve("/a", flat(`../${name}`)));
      check(`resolve from the working directory ${at}`, path.resolve(flat(name)));
      check(`relative into the name ${at}`, path.relative("/a", flat(`/a/${name}`)));
      check(`relative to a sibling ${at}`, path.relative("/a/b", flat(`/a/${name}`)));
      check(`relative out of the name ${at}`, path.relative(flat(`/a/${name}`), "/a/b"));
      check(`relative of an untidy path ${at}`, path.relative("/a/./b", flat(`/a/${name}`)));
      const parsed = path.parse(flat(`/${name}/${plain}.${name}`));
      for (const key of ["root", "dir", "base", "ext", "name"] as const) check(`parse ${key} ${at}`, parsed[key]);
      if (position < 0) withLetter = withCharacter;
      else if (!Bun.deepEquals(withCharacter, withLetter)) wrong.push(`${at}: ${JSON.stringify(withCharacter)}`);
    }
  }
  expect(wrong.slice(0, 20)).toEqual([]);
});

test.each([
  ["posix", posix],
  ["win32", win32],
])("%s: a surrogate is a code unit like any other", (_, path) => {
  const answers = (unit: string) => [
    path.basename(`/a/${unit}`),
    path.basename(`/a/${unit}.txt`, ".txt"),
    path.basename(`/a/b${unit}`, unit),
    path.dirname(`/${unit}/a`),
    path.extname(`a.${unit}`),
    path.format({ dir: unit, name: unit, ext: unit }),
    path.join(unit, "..", unit, unit),
    path.normalize(`./${unit}//${unit}/.`),
    path.relative(`/${unit}`, `/${unit}/${unit}`),
    path.relative("/a", `/${unit}`),
    path.resolve(`/${unit}`, unit),
    path.resolve(unit).slice(-1 - unit.length),
    path.toNamespacedPath(`C:\\${unit}`),
    ...Object.values(path.parse(`/${unit}/${unit}.${unit}`)),
  ];
  for (const unit of ["\ud800", "\udc00", "\ud800\udc00", "\udc00\ud800"]) {
    expect(answers(unit)).toEqual(answers("#").map(answer => answer.replaceAll("#", unit)));
  }
  expect(path.basename("/\ud800\udc00", "\udc00")).toBe("\ud800");
  expect(path.basename("/a\ud800", "\ud801")).toBe("a\ud800");
  expect(path.relative("/a/\ud800", "/a/\ud801")).toBe(`..${path.sep}\ud801`);
  expect([path.matchesGlob("\ud800", "\ud800"), path.matchesGlob("\ud800", "\ud801")]).toEqual([true, false]);
});

test("lengths are counted in code units", () => {
  expect(posix.basename("/", "é")).toBe("/");
  // On Windows the working directory gives them a drive.
  expect(win32.relative("/é", "/éa")).toBe(isWindows ? "..\\éa" : "..éa");
  expect(win32.toNamespacedPath("/é")).toBe(isWindows ? `\\\\?\\${win32.resolve("/é")}` : "/é");
});
