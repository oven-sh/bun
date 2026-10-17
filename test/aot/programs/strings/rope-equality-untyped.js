// Every pair of some 40 internal representations of a few strings, compared with every comparison operator, with operands of three kinds of static type (the same program without type annotations).
// ENV JSC_useDollarVM=1
const wide = (text) => (typeof $vm === "object" ? $vm.make16BitStringIfPossible(text) : ("\u0100" + text).substring(1));
const narrow = (text) => text.split("").join("");
function split(text, at) {
  return narrow(text.slice(0, at)) + narrow(text.slice(at));
}
function splitWide(text, at) {
  return wide(text.slice(0, at)) + wide(text.slice(at));
}
function three(text, a, b) {
  return `${narrow(text.slice(0, a))}${narrow(text.slice(a, b))}${narrow(text.slice(b))}`;
}
function byOne(text) {
  let all = "";
  for (let i = 0;i < text.length; i++)
    all += narrow(text[i]);
  return all;
}
function byOneFromTheRight(text) {
  let all = "";
  for (let i = text.length;i--; )
    all = narrow(text[i]) + all;
  return all;
}
function part(text) {
  return narrow("<<" + text + ">>").slice(2, 2 + text.length);
}
function partWide(text) {
  return wide("<<" + text + ">>").slice(2, 2 + text.length);
}
function ofParts(text, at) {
  return part(text.slice(0, at)) + partWide(text.slice(at));
}
function nested(text) {
  if (text.length < 4)
    return narrow(text);
  const third = text.length / 3 | 0;
  return nested(text.slice(0, third)) + (nested(text.slice(third, 2 * third)) + nested(text.slice(2 * third)));
}
const texts = ["message-100:row-500", "message-100:row-501", "Message-100:row-500", "message-100;row-500", "message-100:row-50", "ab", "ac", "abcdefgh", "abcdefgi", "abcdefghi", "abcdefghj", "x".repeat(300), "x".repeat(299) + "y", "y" + "x".repeat(299), "x".repeat(150) + "y" + "x".repeat(149)];
const makers = [
  narrow,
  wide,
  (text) => split(text, 1),
  (text) => split(text, text.length - 1),
  (text) => split(text, text.length >> 1),
  (text) => splitWide(text, text.length >> 1),
  (text) => three(text, 1, text.length - 1),
  (text) => three(text, text.length >> 2, text.length >> 1),
  byOne,
  byOneFromTheRight,
  part,
  partWide,
  (text) => ofParts(text, text.length >> 1),
  nested,
  (text) => split(text, 1) + "",
  (text) => narrow(text.slice(0, 1)) + wide(text.slice(1))
];
function typed(a, b) {
  return (a === b ? 1 : 0) + (a !== b ? 2 : 0) + (a == b ? 4 : 0) + (Object.is(a, b) ? 8 : 0);
}
function nil(a, b) {
  return (a === b ? 1 : 0) + (a !== b ? 2 : 0) + (a == b ? 4 : 0) + (Object.is(a, b) ? 8 : 0);
}
function any(a, b) {
  return (a === b ? 1 : 0) + (a !== b ? 2 : 0) + (a == b ? 4 : 0) + (Object.is(a, b) ? 8 : 0);
}
function half(a, b) {
  return (a === b ? 1 : 0) + (b !== a ? 2 : 0);
}
function inLoop(a, all) {
  let found = 0;
  for (let i = 0;i < all.length; i++)
    if (all[i] === a)
      found += i + 1;
  return found;
}
function inLoopOfAnything(a, all) {
  let found = 0;
  for (let i = 0;i < all.length; i++)
    if (all[i] === a)
      found += i + 1;
  return found;
}
function bySwitch(a, b, c) {
  switch (a) {
    case b:
      return 1;
    case c:
      return 2;
    default:
      return 3;
  }
}
let sum = 0;
let pairs = 0;
let equal = 0;
const mix = (n) => {
  sum = Math.imul(sum, 31) + n | 0;
};
for (let i = 0;i < texts.length; i++) {
  for (let j = 0;j < texts.length; j++) {
    for (let p = 0;p < makers.length; p++) {
      for (let q = 0;q < makers.length; q++) {
        const want = i === j;
        for (const compare of [typed, nil, any]) {
          const got = compare(makers[p](texts[i]), makers[q](texts[j]));
          if (got !== (want ? 13 : 2))
            console.log("WRONG", compare.name, i, j, p, q, got);
          mix(got);
        }
        const got = half(makers[p](texts[i]), makers[q](texts[j]));
        if (got !== (want ? 1 : 2))
          console.log("WRONG half", i, j, p, q, got);
        pairs++;
        if (want)
          equal++;
      }
    }
  }
}
for (let i = 0;i < texts.length; i++) {
  for (let p = 0;p < makers.length; p++) {
    mix(inLoop(makers[p](texts[i]), texts.map((text) => makers[(p + 3) % makers.length](text))));
    mix(inLoopOfAnything(makers[p](texts[i]), texts.map((text) => makers[(p + 5) % makers.length](text))));
    mix(bySwitch(makers[p](texts[i]), makers[(p + 1) % makers.length](texts[(i + 1) % texts.length]), makers[(p + 2) % makers.length](texts[i])));
  }
}
const kept = split(texts[0], 7);
const other = split(texts[0], 3);
mix(any(kept, other));
mix(typed(kept, other));
mix(any(kept, narrow(texts[0])));
console.log(kept, other, kept.length, kept.charCodeAt(8), (kept + other).length, kept + "|" + other, new Map([[kept, 1]]).get(other), [kept].includes(other), [kept].indexOf(other), new Set([kept, other]).size);
const long = "0123456789".repeat(1000);
console.log(any(byOne(long), byOneFromTheRight(long)), typed(byOne(long), byOneFromTheRight(long)), any(byOne(long), byOne(long.slice(0, -1) + "x")), typed(byOneFromTheRight("x" + long.slice(1)), byOne(long)));
console.log(any(split("12", 1), 12), any(split("ab", 1), null), any(undefined, split("ab", 1)), nil(split("ab", 1), null), nil(null, undefined), nil(null, null), any(10n ** 30n, 10n ** 30n), any(10n ** 30n, 10n ** 30n + 1n), any(split("ab", 1), new String("ab")), any(NaN, NaN), any(0, -0), any(1.5, 1.5));
console.log(pairs, equal, sum);
