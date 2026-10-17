// Regular expressions with the `u` flag on strings with surrogate pairs and unpaired surrogates (the same program without type annotations).
function flat(s) {
  return JSON.parse(JSON.stringify(s));
}
const units = ["a", "\u044F", "\u4E2D", "\uD83D", "\uDE00", "\uD83D\uDE00", "\uD800", "\uDFFF", "\uD800\uDC00", "\uDBFF\uDFFF", "\uFFFF", " "];
const subjects = [];
for (const a of units) {
  subjects.push(flat(a));
  for (const b of units) {
    subjects.push(flat(a + b));
    for (const c of units)
      subjects.push(flat(a + b + c));
  }
}
const once = [
  /./u,
  /^.$/u,
  /^..$/u,
  /^...$/u,
  /.$/u,
  /.{2}/u,
  /.+/su,
  /.*?\u044F/u,
  /\p{L}/u,
  /^\p{L}+$/u,
  /[^\p{L}]/u,
  /\P{L}+/u,
  /\p{L}{2,}/u,
  /[\u{1F600}-\u{1F64F}]/u,
  /^[\u{10000}-\u{10ffff}]+$/u,
  /[^\u{10000}-\u{10ffff}]/u,
  /[\ud800-\udbff]/u,
  /[\udc00-\udfff]/u,
  /[^\ud800-\udfff]+/u,
  /\ud83d/u,
  /\ude00/u,
  /\u{1F600}/u,
  /\u{1F600}+/u,
  /\u{10ffff}$/u,
  /\S\s/u,
  /\s\S/u,
  /(.)\1/u,
  /(\p{L})\1/u,
  /(?:.\p{L})+/u,
  /^(?:\p{L}|\p{So})*$/u,
  /\p{Extended_Pictographic}/u,
  /\p{Cs}/u,
  /\P{Cs}/u,
  /\w|\W/u,
  /\W\w/u,
  /\b./u,
  /.\B/u,
  /\u042F/iu,
  /[\u0430-\u044F]+/iu,
  /[^\u0430-\u044F]/iu,
  /\u{10000}|\u4E2D/u,
  /(?=.)\p{L}/u,
  /(?!\p{L})./u,
  /(?<=.)\p{L}/u,
  /(?<!\p{L})./u,
  /(?<=\u{1F600})./u,
  /[\p{L}--[a-z]]/v,
  /[\p{L}&&\p{Script=Cyrillic}]/v,
  /^\p{RGI_Emoji}$/v
];
const fromEveryPlace = [/./yu, /\p{L}/yu, /[^\p{L}]/yu, /\P{L}+/yu, /[\udc00-\udfff]/yu, /[\u{10000}-\u{10ffff}]/yu, /./gu, /\p{So}|\p{L}/gu, /(?:)/gu, /.??/gu, /\ude00/gu, /\S/yu];
function mix(h, x) {
  return Math.imul(h ^ x, 16777619) >>> 0;
}
for (let i = 0;i < once.length; i++) {
  const re = once[i];
  let found = 0, h = 2166136261;
  for (const s of subjects) {
    const m = re.exec(s);
    if (m) {
      found++;
      h = mix(mix(h, m.index), m[0].length);
      if (m.length > 1 && m[1] !== undefined)
        h = mix(h, m[1].length);
    } else
      h = mix(h, 977);
  }
  console.log("once", i, found, h);
}
for (let i = 0;i < fromEveryPlace.length; i++) {
  const re = fromEveryPlace[i];
  let found = 0, h = 2166136261;
  for (const s of subjects) {
    for (let at = 0;at <= s.length; at++) {
      re.lastIndex = at;
      const m = re.exec(s);
      if (m) {
        found++;
        h = mix(mix(mix(h, m.index), m[0].length), re.lastIndex);
      } else
        h = mix(h, 977 + re.lastIndex);
    }
  }
  console.log("from every place", i, found, h);
}
let pieces = 0;
let h = 2166136261;
for (const s of subjects) {
  const all = s.match(/./gu);
  pieces += all ? all.length : 0;
  h = mix(h, s.replace(/\p{L}/gu, "<$&>").length);
  h = mix(h, s.split(/(?:)/u).length);
  h = mix(h, s.search(/\p{So}/u) + 1);
  h = mix(h, s.replace(/[^\p{L}]+/gu, "").length);
}
console.log("methods", pieces, h, subjects.length);
