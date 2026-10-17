// String operations on null, undefined, out-of-range indices and other inputs that the fast paths must reject (the same program without type annotations).
const say = globalThis.print ?? console.log;
function attempt(f) {
  try {
    return String(f());
  } catch (e) {
    return e.constructor.name;
  }
}
function unitOfNil(x) {
  return x.charCodeAt(0);
}
function sumOfUnits(s, n) {
  let t = 0;
  for (let i = 0;i < n; i++)
    t += s.charCodeAt(i);
  return t;
}
function pointAt(s, i) {
  return s.codePointAt(i);
}
function millions(i) {
  const n = (i | 0) * 1e6;
  return "<" + n + ">";
}
function startsWithText(s, t) {
  return s.startsWith(t);
}
function endsWithText(s, t) {
  return s.endsWith(t);
}
function isAb(x) {
  return x === "ab";
}
function isAbcd(x) {
  return x === "abcd";
}
function isAbcdefghij(x) {
  return x === "abcdefghij";
}
function same(a, b) {
  return a === b;
}
function wholeOf(s) {
  return s.slice(0, s.length);
}
function unsigned(x) {
  return "<" + (x >>> 0) + ">";
}
function unsignedAlone(x) {
  return String(x >>> 0);
}
function whichOfTwo(x) {
  if (x === "ab")
    return 1;
  else if (x === "cd")
    return 2;
  return 0;
}
function made(...units) {
  return String.fromCharCode(...units);
}
function countSame(list, x) {
  let n = 0;
  for (let i = 0;i < list.length; i++)
    if (list[i] === x)
      n++;
  return n;
}
function countAb(list) {
  let n = 0;
  for (let i = 0;i < list.length; i++)
    if (list[i] === "ab")
      n++;
  return n;
}
function countAbcd(list) {
  let n = 0;
  for (let i = 0;i < list.length; i++)
    if (list[i] === "abcd")
      n++;
  return n;
}
const wide = ["x\uD835\uDC00y", "\uD835x", "a\uD835", "\u6261\u6463", "\u6261\u6463\u6665\u6867", "\u6261\u6463\u6665\u6867\u6A69zzzzz", "\u6261X", "\u6261Y"];
const narrow = ["ab", "abcd", "abcdefghij", "abc", ""];
say(attempt(() => unitOfNil(undefined)) + " " + attempt(() => unitOfNil(null)) + " " + attempt(() => unitOfNil("A")));
say(sumOfUnits(undefined, 0) + " " + sumOfUnits("AB", 2) + " " + attempt(() => sumOfUnits(undefined, 1)));
say([pointAt(wide[0].slice(0, 2), 1), pointAt(wide[0], 1), pointAt(wide[1], 0), pointAt(wide[2], 1)].join(" "));
say([millions(1), millions(5000), millions(3000000), millions(-3000000)].join(" "));
const empty = narrow[3].slice(1, 1);
say([startsWithText(narrow[3], empty), endsWithText(narrow[3], empty), startsWithText(empty, empty), startsWithText(narrow[3], narrow[0]), same(empty, narrow[4])].join(" "));
say([isAb(wide[3]), isAb(narrow[0]), isAbcd(wide[4]), isAbcd(narrow[1]), isAbcdefghij(wide[5]), isAbcdefghij(narrow[2])].join(" "));
say([same(wide[3], narrow[0].slice(0)), same(narrow[0], wide[3]), same(wide[6], wide[7]), same(wide[6], "\u6261" + "X"), same(wide[4], narrow[1])].join(" "));
say([isAb(wide[4].slice(0, 2)), isAbcd((wide[5] + "").slice(0, 4)), same(wide[4].slice(0, 2), narrow[0])].join(" "));
say(wholeOf(narrow[2]) + " " + wholeOf(wide[6]).length);
say([unsigned(1), unsigned(-1), unsigned(2147483648), unsigned(-2147483648)].join(" "));
say([countSame(wide, narrow[0]), countSame(wide, wide[6]), countSame(narrow, wide[3]), countSame([wide[6], wide[7], "\u6261" + "X"], wide[6]), countSame([wide[4], narrow[1]], narrow[1])].join(" "));
const parts = [wide[4].slice(0, 2), wide[5].slice(0, 4), narrow[2].slice(0, 2), narrow[2].slice(0, 4), wide[4].slice(1, 3)];
say([countAb(parts), countAbcd(parts), countAb(wide), countAbcd(wide), countSame(parts, narrow[0]), countSame(parts, narrow[1])].join(" "));
say([unsignedAlone(1), unsignedAlone(-1), unsignedAlone(2147483648), unsignedAlone(-2147483648)].join(" "));
say([whichOfTwo(wide[4].slice(0, 2)), whichOfTwo(wide[4].slice(1, 3)), whichOfTwo(narrow[2].slice(0, 2)), whichOfTwo(narrow[2].slice(2, 4)), whichOfTwo(wide[3]), whichOfTwo(narrow[0])].join(" "));
const fresh = [made(25185, 88), made(25185, 89), made(97, 98), made(25185, 25699), made(25185, 88)];
say([countSame(fresh, made(25185, 88)), countSame(fresh, made(97, 98)), countSame(fresh, made(25185, 90)), countSame([made(97, 98), made(97, 99)], made(25185, 25699))].join(" "));
