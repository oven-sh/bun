// One untyped `for..of` is given everything that can be iterated, and among it strings that nothing in the program announces: they come out of JSON.parse. Latin-1 and 16-bit strings, pairs and lone surrogates, ropes and slices are walked by code points, and break, return and throw leave them as they leave any other iterable. Every line prints what plain Bun prints.
const collect = globalThis.gc ?? (() => Bun.gc(true));
const log = [];

function units(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) out += (i ? "." : "") + text.charCodeAt(i).toString(16);
  return out;
}
function show(value) {
  if (typeof value === "string") return "'" + units(value) + "'";
  if (Array.isArray(value)) return "[" + value.map(item => show(item)).join(",") + "]";
  return Object.is(value, -0) ? "-0" : String(value);
}
function brief(text) {
  if (text.length <= 120) return text;
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  return text.slice(0, 48) + " .. " + text.slice(-24) + " (" + text.length + " units, hash " + hash + ")";
}

function walk(x) {
  let out = "";
  for (const c of x) out += "<" + show(c) + ">";
  return out;
}
function firstTwo(x) {
  let out = "";
  let seen = 0;
  for (const c of x) {
    out += show(c);
    if (++seen === 2) break;
  }
  return out;
}
function firstThatIsNotA(x) {
  for (const c of x) if (c !== "a") return show(c);
  return "none";
}
function throwsAtB(x) {
  let seen = 0;
  try {
    for (const c of x) {
      if (c === "b") throw new Error("threw after " + seen);
      seen++;
    }
    return "through " + seen;
  } catch (error) {
    return error.name === "Error" ? error.message : "throws " + error.name;
  }
}
function throwsAtAPair(x) {
  let seen = 0;
  try {
    for (const c of x) {
      if (c === "\u{1F600}") throw new Error("threw after " + seen);
      seen++;
    }
    return "through " + seen;
  } catch (error) {
    return error.name === "Error" ? error.message : "throws " + error.name;
  }
}
function everyOther(x) {
  let out = "";
  let seen = 0;
  for (const c of x) {
    if (seen++ & 1) continue;
    out += show(c);
  }
  return out;
}
function returnsThroughFinally(x) {
  try {
    for (const c of x) return show(c);
    return "nothing";
  } finally {
    log.push("finally");
  }
}
function takenApart(x) {
  const [a, b, ...rest] = x;
  return show(a) + " " + show(b) + " " + show(rest);
}
function headOnly(x) {
  const [a] = x;
  return show(a);
}
function secondOrDefault(x) {
  const [, b = "default"] = x;
  return show(b);
}
function spread(x) {
  return show([...x]);
}
function squared(x) {
  let same = 0;
  let all = 0;
  for (const a of x) {
    for (const b of x) {
      all++;
      if (a === b) same++;
    }
  }
  return same + " of " + all;
}
function untilSeenTwice(x) {
  let steps = 0;
  outer: for (const a of x) {
    let seen = 0;
    for (const b of x) {
      steps++;
      if (a === b && ++seen === 2) break outer;
    }
  }
  return steps;
}
function twoLoops(x) {
  let out = "";
  for (const c of x) out += show(c);
  out += "+";
  for (const c of x) out += show(c);
  return out;
}
function variableChanges(x) {
  let out = "";
  for (const c of x) {
    out += show(c);
    x = "zz";
  }
  return out + " then " + show(x);
}
function growsWhileWalked(x) {
  let text = x;
  let turns = 0;
  for (const c of text) {
    text += c;
    turns++;
  }
  return turns + " " + show(text);
}
function eachTakenApart(x) {
  let out = "";
  for (const [a, b] of x) out += show(a) + ":" + show(b) + " ";
  return out;
}
function captured(x) {
  const readers = [];
  for (const c of x) readers.push(() => c);
  return show(readers.map(read => read()));
}
function collectedBetween(x) {
  let out = "";
  let turns = 0;
  for (const c of x) {
    if (turns++ < 3) collect();
    out += show(c);
  }
  return out;
}
function* spelled(x) {
  for (const c of x) yield c;
}
function* delegated(x) {
  yield* x;
}
function interleaved(x) {
  const one = spelled(x);
  const other = spelled(x);
  let out = "";
  for (let p = one.next(), q = other.next(); !p.done && !q.done; p = one.next(), q = other.next()) out += show(p.value) + show(q.value);
  return out;
}
async function awaitedInside(x) {
  let out = "";
  for (const c of x) out += show(await c);
  return out;
}
async function awaitedEach(x) {
  let out = "";
  for await (const c of x) out += show(c);
  return out;
}

const walkers = {
  walk,
  firstTwo,
  firstThatIsNotA,
  throwsAtB,
  throwsAtAPair,
  everyOther,
  returnsThroughFinally,
  takenApart,
  headOnly,
  secondOrDefault,
  spread,
  squared,
  untilSeenTwice,
  twoLoops,
  variableChanges,
  growsWhileWalked,
  eachTakenApart,
  captured,
  collectedBetween,
  spelled: x => walk(spelled(x)),
  spelledAndLeft: x => firstTwo(spelled(x)),
  delegated: x => walk(delegated(x)),
  interleaved,
  awaitedInside,
  awaitedEach,
};

const fromOutside = JSON.parse(`[
  ["the empty string", ""],
  ["one character", "a"],
  ["two characters", "ab"],
  ["one character three times", "aaa"],
  ["Latin-1", "b\\u00e9\\u00ffa"],
  ["0xff beside 0x100", "\\u00ff\\u0100"],
  ["16-bit", "\\u65e5\\u672c\\u8a9e"],
  ["a pair", "\\ud83d\\ude00"],
  ["a pair between characters", "a\\ud83d\\ude00b"],
  ["one pair twice", "\\ud83d\\ude00\\ud83d\\ude00"],
  ["two pairs", "\\ud83d\\udc4d\\ud83c\\udffd"],
  ["a lone lead", "\\ud83d"],
  ["a lone trail", "\\ude00"],
  ["a lone lead at the start", "\\ud83dab"],
  ["a lone lead at the end", "ab\\ud83d"],
  ["a lone trail at the start", "\\ude00ab"],
  ["a lone trail at the end", "ab\\ude00"],
  ["lone surrogates at both ends", "\\ude00a\\ud83d"],
  ["a lead in front of a pair", "\\ud83d\\ud83d\\ude00"],
  ["a trail behind a pair", "\\ud83d\\ude00\\ude00"],
  ["a trail in front of a lead", "\\ude00\\ud83d"],
  ["a combining mark", "e\\u0301"],
  ["an array of integers from outside", [1, 2, 3]],
  ["an empty array from outside", []],
  ["an array of strings from outside", ["a", "bc", "", "b"]],
  ["an array of arrays from outside", [[1, "one"], ["two", 2]]],
  ["an array of everything from outside", [1.5, null, true, "a", -0, "\\ud83d\\ude00"]]
]`);
const piece = JSON.parse(`{ "ab": "ab", "cd": "cd", "lead": "\\ud83d", "trail": "\\ude00", "wide": "\\u65e5\\ud83d\\ude00\\u672c", "padded": "xxabcdefxx" }`);

function built(part, count) {
  let text = "";
  for (let i = 0; i < count; i++) text += part;
  return text;
}
function* counted(count) {
  try {
    for (let i = 0; i < count; i++) yield i;
  } finally {
    log.push("generator closed");
  }
}
function* letters() {
  yield "a";
  yield "b";
  yield "\u{1F600}";
  yield "a";
}
function begun(iterator) {
  iterator.next();
  return iterator;
}
function watched(values) {
  let at = 0;
  return {
    [Symbol.iterator]() {
      log.push("open");
      return this;
    },
    next() {
      log.push("next");
      return at < values.length ? { value: values[at++], done: false } : { value: undefined, done: true };
    },
    return() {
      log.push("return");
      return {};
    },
  };
}
function withOwnIterator(object) {
  object[Symbol.iterator] = function* () {
    yield "own";
    yield "iterator";
  };
  return object;
}

const subjects = [];
for (const [name, value] of fromOutside) subjects.push([name, () => value]);
subjects.push(
  ["a rope", () => piece.ab + piece.cd],
  ["a rope whose halves are the halves of a pair", () => piece.lead + piece.trail],
  ["a rope that ends in a lead", () => piece.ab + piece.lead],
  ["a rope that starts with a trail", () => piece.trail + piece.ab],
  ["a rope of 8-bit and 16-bit text", () => piece.ab + piece.wide],
  ["a rope of ropes", () => piece.ab + piece.cd + (piece.wide + piece.ab)],
  ["a rope of three", () => `${piece.ab}${piece.lead}${piece.trail}`],
  ["a slice", () => piece.padded.slice(2, 8)],
  ["a slice that is a pair", () => piece.wide.slice(1, 3)],
  ["a slice that starts inside a pair", () => piece.wide.slice(2)],
  ["a slice that ends inside a pair", () => piece.wide.slice(0, 2)],
  ["a slice of one character", () => piece.padded.slice(3, 4)],
  ["an empty slice", () => piece.padded.slice(3, 3)],
  ["a slice of a rope", () => (piece.padded + piece.wide + piece.padded).slice(8, 16)],
  ["a rope of slices", () => piece.padded.slice(2, 5) + piece.wide.slice(1, 3)],
  ["a rope built in a loop", () => built(piece.ab, 600)],
  ["a 16-bit rope built in a loop", () => built(piece.wide, 200)],
  ["a repeated string", () => piece.cd.repeat(300)],
  ["a String object", () => new String(piece.ab + piece.lead + piece.trail)],
  ["an empty String object", () => new String(fromOutside[0][1])],
  ["Object of a string", () => Object(piece.cd)],
  ["a String object with an iterator of its own", () => withOwnIterator(new String(piece.ab))],
  ["an array", () => [1, 2, 3]],
  ["an array with a hole", () => [1, , 3]],
  ["an array of characters", () => ["a", "b", "a"]],
  ["an array with an iterator of its own", () => withOwnIterator([1, 2])],
  ["a typed array", () => new Uint8Array([7, 8, 9])],
  ["arguments", () => (function () { return arguments; })(1, "b")],
  ["a Set", () => new Set([1, "a", 1.5, "a", "b"])],
  ["an empty Set", () => new Set()],
  ["a Set of the characters of a string", () => new Set(piece.padded)],
  ["a Map", () => new Map([[1, "one"], ["two", 2]])],
  ["the keys of a Map", () => new Map([["a", 1], ["b", 2]]).keys()],
  ["the values of a Map", () => new Map([[1, "a"], [2, "b"]]).values()],
  ["the entries of an array", () => ["a", "b"].entries()],
  ["a generator", () => counted(3)],
  ["a generator that has begun", () => begun(counted(3))],
  ["a generator of strings", () => letters()],
  ["the iterator of a string", () => (piece.ab + piece.wide)[Symbol.iterator]()],
  ["the iterator of a string that has begun", () => begun(piece.wide[Symbol.iterator]())],
  ["an iterator with return", () => watched([1, "a", "a", 2])],
  ["an iterator with return that gives characters", () => watched(["a", "b", "\u{1F600}"])],
  ["an iterator with return that gives nothing", () => watched([])],
  ["an iterable that hands out the iterator of a string", () => ({ [Symbol.iterator]: () => piece.cd[Symbol.iterator]() })],
  ["an iterable that hands out a string", () => ({ [Symbol.iterator]: () => piece.cd })],
  ["an iterable that hands out undefined", () => ({ [Symbol.iterator]: () => undefined })],
  ["a number", () => 5],
  ["undefined", () => undefined],
  ["null", () => null],
  ["true", () => true],
  ["a bigint", () => 10n],
  ["a symbol", () => Symbol.iterator],
  ["an object", () => ({})],
  ["a function", () => walk],
);

for (const [name, make] of subjects) {
  for (const [way, walker] of Object.entries(walkers)) {
    let answer;
    try {
      answer = await walker(make());
    } catch (error) {
      answer = "throws " + error.name;
    }
    console.log(name + " / " + way + ": " + brief(String(answer)) + (log.length ? " {" + log.join() + "}" : ""));
    log.length = 0;
  }
}

function measured(x) {
  let total = 0;
  for (const c of x) total += typeof c === "string" ? c.length : 1;
  return total;
}
let total = 0;
for (let turn = 0; turn < 30000; turn++) {
  const value = fromOutside[turn % fromOutside.length][1];
  total += measured(value);
  if (turn % 7 === 0) total += measured(value + piece.wide);
  if (turn % 11 === 0) total += measured(piece.padded.slice(turn % 5, 9));
}
console.log("units walked in 30000 turns: " + total);
