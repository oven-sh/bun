// charCodeAt and codePointAt at numbers of every kind: whole numbers, fractions, -0, NaN, the infinities and numbers beyond every string, written as constants and read from parameters, an array, a field, a captured variable and the read before, on flat strings, ropes and slices, with pairs and lone surrogates. Every line prints what plain Bun prints (the same program without type annotations).
const never = Date.now() < 0;
const hidden = (text) => (never ? text + "!" : text);
const flat = (text) => hidden(text.split("").join(""));
const rope = (text) => (text.length < 2 ? flat(text) : flat(text.slice(0, 1)) + flat(text.slice(1)));
const cut = (text) => flat("<" + text + ">").slice(1, -1);
const cutBetweenHalves = (text) => flat("\ud83d" + text + "\ude00").slice(1, -1);
const makers = [["flat", flat], ["rope", rope], ["slice", cut], ["slice between the halves of a pair", cutBetweenHalves]];

function show(value) {
  return value === undefined ? "none" : Object.is(value, -0) ? "-0" : String(value);
}
function unitsOf(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) out += (i ? "." : "") + text.charCodeAt(i).toString(16);
  return "'" + out + "'";
}
function placesFor(length) {
  return [
    0, -0, 0.5, 1, 1.5, 2, -0.5, -1, -1.5, NaN, Infinity, -Infinity, 2 ** 31 - 1, 2 ** 31, -(2 ** 31), -(2 ** 31) - 1, 2 ** 32, 2 ** 32 + 1, 2 ** 53, -(2 ** 53), 1e300, Number.MIN_VALUE,
    length - 2, length - 1, length - 0.5, length, length + 0.5, length + 1,
  ];
}

function unitAt(text, at) {
  return text.charCodeAt(at);
}
function pointAt(text, at) {
  return text.codePointAt(at);
}
function unitsAtConstants(text) {
  return [
    text.charCodeAt(0), text.charCodeAt(-0), text.charCodeAt(0.5), text.charCodeAt(1.5), text.charCodeAt(-1), text.charCodeAt(NaN), text.charCodeAt(Infinity), text.charCodeAt(-Infinity),
    text.charCodeAt(2 ** 31), text.charCodeAt(2 ** 32 + 1), text.charCodeAt(text.length - 1), text.charCodeAt(text.length),
  ].map(unit => show(unit)).join(" ");
}
function pointsAtConstants(text) {
  return [
    text.codePointAt(0), text.codePointAt(-0), text.codePointAt(0.5), text.codePointAt(1.5), text.codePointAt(-1), text.codePointAt(NaN), text.codePointAt(Infinity), text.codePointAt(-Infinity),
    text.codePointAt(2 ** 31), text.codePointAt(2 ** 32 + 1), text.codePointAt(text.length - 1), text.codePointAt(text.length),
  ].map(point => show(point)).join(" ");
}
function readAtAll(text, places) {
  let out = "";
  for (let i = 0; i < places.length; i++) out += (i ? " " : "") + show(text.charCodeAt(places[i])) + "/" + show(text.codePointAt(places[i]));
  return out;
}

class Cursor {
  text;
  at;
  constructor(text, at) {
    this.text = text;
    this.at = at;
  }
  unit() {
    return this.text.charCodeAt(this.at);
  }
  point() {
    return this.text.codePointAt(this.at);
  }
  unitBehind(distance) {
    return this.text.charCodeAt(this.at + distance);
  }
  scan() {
    let out = "";
    while (this.at < this.text.length) {
      const point = this.text.codePointAt(this.at);
      out += (out ? " " : "") + point.toString(16);
      this.at += point >= 0x10000 ? 2 : 1;
    }
    return out;
  }
}
function readAtField(text, places) {
  const cursor = new Cursor(text, 0);
  let out = "";
  for (const place of places) {
    cursor.at = place;
    out += (out ? " " : "") + show(cursor.unit()) + "/" + show(cursor.point()) + "/" + show(cursor.unitBehind(1)) + "/" + show(cursor.unitBehind(-0.5));
  }
  return out;
}

function makeReader(text) {
  let at = 0;
  return {
    moveTo(place) {
      at = place;
    },
    unit: () => text.charCodeAt(at),
    point: () => text.codePointAt(at),
  };
}
function readAtCapturedVariable(text, places) {
  const reader = makeReader(text);
  let out = "";
  for (const place of places) {
    reader.moveTo(place);
    out += (out ? " " : "") + show(reader.unit()) + "/" + show(reader.point());
  }
  return out;
}

let placeOfModule = 0;
function unitAtPlaceOfModule(text) {
  return text.charCodeAt(placeOfModule);
}
function pointAtPlaceOfModule(text) {
  return text.codePointAt(placeOfModule);
}
function readAtVariableOfModule(text, places) {
  let out = "";
  for (const place of places) {
    placeOfModule = place;
    out += (out ? " " : "") + show(unitAtPlaceOfModule(text)) + "/" + show(pointAtPlaceOfModule(text));
  }
  return out;
}

function kindAt(text, at) {
  const unit = text.charCodeAt(at);
  if (unit === 47) return "slash";
  if (unit >= 48 && unit <= 57) return "digit" + (unit - 48);
  if (unit !== unit) return "outside";
  switch (unit) {
    case 97:
      return "a";
    case 0xe9:
      return "acute";
    case 0xd83d:
      return "lead";
    case 0xde00:
      return "trail";
  }
  return "other" + (unit & 0xff) + "." + (unit >> 8);
}
function sizeAt(text, at) {
  const point = text.codePointAt(at);
  if (point === undefined) return "outside";
  if (point >= 0x10000) return "pair" + (point - 0x10000);
  if ((point & 0xfc00) === 0xd800) return "lead";
  if ((point & 0xfc00) === 0xdc00) return "trail";
  return point < 0x100 ? "narrow" : "wide";
}
function arithmeticAt(text, at) {
  const unit = text.charCodeAt(at);
  const point = text.codePointAt(at);
  return [unit + 1, unit * 2, unit - 0.5, unit | 0, unit & 15, unit >>> 1, unit ^ 255, -unit, unit / 2, unit % 7, Math.max(unit, 3), (point ?? -1) + 1, (point ?? 0.5) * 2, (point ?? NaN) | 0, (point ?? -0) >> 4]
    .map(value => show(value))
    .join(" ");
}
function middleUnit(text, low, high) {
  return text.charCodeAt((low + high) / 2);
}
function middlePoint(text, low, high) {
  return text.codePointAt((low + high) / 2);
}

function chainOfThree(text, k) {
  k = text.charCodeAt(k);
  k = text.charCodeAt(k);
  k = text.charCodeAt(k);
  return k;
}
function chainShown(text, k) {
  let out = show(k);
  k = text.charCodeAt(k);
  out += ">" + show(k);
  k = text.charCodeAt(k);
  out += ">" + show(k);
  k = text.charCodeAt(k);
  return out + ">" + show(k);
}
function chainInLoop(text, k, turns) {
  for (let turn = 0; turn < turns; turn++) k = text.charCodeAt(k);
  return k;
}
function chainOfPoints(text, k, turns) {
  for (let turn = 0; turn < turns; turn++) k = text.codePointAt(k) ?? 0.5;
  return k;
}

function unitOfSlice(text, from, to, at) {
  return text.slice(from, to).charCodeAt(at);
}
function pointOfSlice(text, from, to, at) {
  return text.slice(from, to).codePointAt(at);
}
function unitOfSum(left, right, at) {
  return (left + right).charCodeAt(at);
}
function pointOfSum(left, right, at) {
  return (left + right).codePointAt(at);
}
function unitOfMissing(text, at) {
  return text?.charCodeAt(at);
}
function pointOfMissing(text, at) {
  return text?.codePointAt(at);
}
function readAtAnything(text, at) {
  try {
    return show(text.charCodeAt(at)) + "/" + show(text.codePointAt(at));
  } catch (error) {
    return error.name;
  }
}

const texts = [
  "", "a", "abc", "/0 9a", "\u00e9\u00ff", "a\u0100", "\u65e5\u672c\u8a9e", "\ud83d\ude00", "a\ud83d\ude00b", "\ud83d\ude00\ud83d\ude00", "ab\ud83d", "\ud83d", "\ude00ab", "a\ude00", "\ud83dx",
  "\ud83d\ud83d\ude00", "\ude00\ud83d",
];
for (const text of texts) {
  const places = placesFor(text.length);
  console.log(unitsOf(text) + " at " + places.map(place => show(place)).join(" "));
  for (const [kind, make] of makers) {
    console.log(kind + ", parameters: " + places.map(place => show(unitAt(make(text), place)) + "/" + show(pointAt(make(text), place))).join(" "));
    console.log(kind + ", constants: " + unitsAtConstants(make(text)) + " | " + pointsAtConstants(make(text)));
    console.log(kind + ", an array: " + readAtAll(make(text), places));
    console.log(kind + ", a field: " + readAtField(make(text), places));
    console.log(kind + ", a captured variable: " + readAtCapturedVariable(make(text), places));
    console.log(kind + ", a variable of the module: " + readAtVariableOfModule(make(text), places));
    console.log(kind + ", kinds: " + places.map(place => kindAt(make(text), place) + "/" + sizeAt(make(text), place)).join(" "));
    console.log(kind + ", scanned: " + new Cursor(make(text), 0).scan() + " | " + new Cursor(make(text), 1).scan() + " | " + new Cursor(make(text), 0.5).scan());
    let middles = "";
    for (let low = 0; low <= text.length; low++) for (let high = low; high <= text.length + 1; high++) middles += " " + show(middleUnit(make(text), low, high)) + "/" + show(middlePoint(make(text), low, high));
    console.log(kind + ", middles:" + middles);
  }
  for (const place of [0, 0.5, 1, text.length - 1, text.length, -1, NaN]) console.log("arithmetic at " + show(place) + ": " + arithmeticAt(flat(text), place));
}

const chains = ["\u0003\u0000\u0005\u0001\u0002\u0004", "\u0001\u0002\u0003\u0004\u0005\u0006", "\u0002\u0100\u0001", "\u0001\ud83d\ude00\u0000", "\u0000", ""];
for (const text of chains) {
  for (const [kind, make] of makers) {
    let line = unitsOf(text) + " " + kind + ":";
    for (const start of [0, 1, 2, 3.9, 5, 6, -1, NaN, -0, 1e10]) {
      line += " " + chainShown(make(text), start) + "=" + show(chainOfThree(make(text), start)) + "," + show(chainInLoop(make(text), start, 10)) + "," + show(chainOfPoints(make(text), start, 7));
    }
    console.log(line);
  }
}

const base = "ab\ud83d\ude00cd\u00e9";
for (const [kind, make] of makers) {
  for (const [from, to] of [[0, 3], [1, 3], [2, 4], [3, 5], [3, 7], [2, 2], [-3, -1], [0, 100]]) {
    let line = kind + ", slice " + from + " to " + to + ":";
    for (const at of [0, 1, 2, 3, 0.5, 1.5, -1, -0, NaN, 2 ** 32, Infinity]) line += " " + show(unitOfSlice(make(base), from, to, at)) + "/" + show(pointOfSlice(make(base), from, to, at));
    console.log(line);
  }
  for (const split of [0, 1, 3, 4, 7]) {
    let line = kind + ", sum split at " + split + ":";
    for (const at of [0, 2, 2.5, 3, 4, 6, 7, -1, NaN, 2 ** 31]) line += " " + show(unitOfSum(make(base.slice(0, split)), make(base.slice(split)), at)) + "/" + show(pointOfSum(make(base.slice(0, split)), make(base.slice(split)), at));
    console.log(line);
  }
}

console.log("missing: " + [0, 1.5, NaN, 9].map(at => show(unitOfMissing(undefined, at)) + "/" + show(pointOfMissing(undefined, at)) + "/" + show(unitOfMissing(flat(base), at)) + "/" + show(pointOfMissing(flat(base), at))).join(" "));
const oddPlaces = ["1", "2.9", " 3 ", "x", "", "Infinity", null, undefined, true, false, [2], [], [1, 2], {}, { valueOf: () => 2 }, { toString: () => "3" }, 2n, Symbol.iterator];
console.log("places that are no numbers: " + oddPlaces.map(at => readAtAnything(flat(base), at)).join(" "));

const steady = flat("a\u00e9/0 9z");
const wideSteady = flat("a\ud83d\ude00\u65e5z");
const steadyPlaces = placesFor(steady.length);
let sum = 0;
for (let turn = 0; turn < 50000; turn++) {
  const unit = unitAt(steady, steadyPlaces[turn % steadyPlaces.length]);
  if (unit === unit) sum += unit;
  sum += pointAt(wideSteady, steadyPlaces[(turn * 7) % steadyPlaces.length]) ?? 1;
  sum = (sum + chainOfThree(chains[0], turn % 6)) % 1000003;
}
console.log("sum of 50000 turns: " + sum);
