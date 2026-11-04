import { serialize } from "bun:jsc";
import { expect, test } from "bun:test";
import { posix } from "node:path";

// What Node's lib/path.js does, a character at a time.
const SLASH = 47;
const DOT = 46;
function dirname(path: string) {
  if (path.length === 0) return ".";
  const hasRoot = path.charCodeAt(0) === SLASH;
  let end = -1;
  let matchedSlash = true;
  for (let i = path.length - 1; i >= 1; --i) {
    if (path.charCodeAt(i) !== SLASH) matchedSlash = false;
    else if (!matchedSlash) {
      end = i;
      break;
    }
  }
  if (end === -1) return hasRoot ? "/" : ".";
  if (hasRoot && end === 1) return "//";
  return path.slice(0, end);
}
function basename(path: string) {
  let start = 0;
  let end = -1;
  let matchedSlash = true;
  for (let i = path.length - 1; i >= 0; --i) {
    if (path.charCodeAt(i) === SLASH) {
      if (!matchedSlash) {
        start = i + 1;
        break;
      }
    } else if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
  }
  return end === -1 ? "" : path.slice(start, end);
}
function extname(path: string) {
  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let matchedSlash = true;
  let preDotState = 0;
  for (let i = path.length - 1; i >= 0; --i) {
    const code = path.charCodeAt(i);
    if (code === SLASH) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
    if (code === DOT) {
      if (startDot === -1) startDot = i;
      else if (preDotState !== 1) preDotState = 1;
    } else if (startDot !== -1) preDotState = -1;
  }
  if (
    startDot === -1 ||
    end === -1 ||
    preDotState === 0 ||
    (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
  )
    return "";
  return path.slice(startDot, end);
}

// A string is serialized with one byte or two for each character, as it is held.
const isWide = (text: string) => serialize(text).byteLength > serialize("x".repeat(text.length)).byteLength;
// A string of its own that is no rope.
const flat = (text: string) => Buffer.from(text, "latin1").toString("latin1");

const letters = ["/", ".", "a", "é"];
const ends = [""];
for (let from = 0, length = 1; length <= 4; length++) {
  const to = ends.length;
  for (; from < to; from++) for (const letter of letters) ends.push(ends[from] + letter);
}

// The functions look at a path in blocks of 8, 16 and 32 characters from either end: the run in the middle puts every shape of a start and of an end at every place in a block.
test.each(["", "/", "//", "a/", "é/", "./", "a.", "/é"])(
  "a path that starts with %j, a run of up to 69 characters, and every end of up to four characters",
  start => {
    const wrong: string[] = [];
    for (let run = 0; run < 70; run++) {
      for (const end of ends) {
        const path = start + "x".repeat(run) + end;
        for (const [name, answer, expected] of [
          ["dirname", posix.dirname(flat(path)), dirname(path)],
          ["basename", posix.basename(flat(path)), basename(path)],
          ["extname", posix.extname(flat(path)), extname(path)],
        ]) {
          if (answer !== expected)
            wrong.push(`${name}(${JSON.stringify(path)}): ${JSON.stringify(answer)}, not ${JSON.stringify(expected)}`);
          // A string of one character is one that all share, and one of two may be.
          else if (path.includes("é") && answer.length > 2 && isWide(answer) !== answer.includes("é"))
            wrong.push(`${name}(${JSON.stringify(path)}): ${JSON.stringify(answer)} is held in the wrong width`);
        }
      }
    }
    expect(wrong.slice(0, 20)).toEqual([]);
  },
);
