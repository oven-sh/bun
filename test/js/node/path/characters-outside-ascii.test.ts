import { serialize } from "bun:jsc";
import { expect, test } from "bun:test";
import { posix, win32 } from "node:path";

// A string is serialized with one byte or two for each character, as it is held.
const isWide = (text: string) => serialize(text).byteLength > serialize("x".repeat(text.length)).byteLength;

// An answer is held in 16 bits if and only if one of its characters is outside ASCII, whatever else the operands hold.
// A string of one character is one that all share.
test.each([
  ["posix", posix],
  ["win32", win32],
])("%s: one character outside ASCII at every position of a name of every length up to 100", (_, path) => {
  const wrong: string[] = [];
  function check(call: string, answer: string) {
    if (answer.length > 1 && isWide(answer) !== /[^\x00-\x7f]/.test(answer))
      wrong.push(`${call}: ${JSON.stringify(answer)}`);
  }
  for (let length = 1; length <= 100; length++) {
    for (let position = -1; position < length; position++) {
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
    }
  }
  expect(wrong.slice(0, 20)).toEqual([]);
});
