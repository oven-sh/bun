// `value === "literal"` outside loops, for values of every kind and strings of every internal representation (the same program without type annotations).
function made(text) {
  const rope = text.slice(0, 1) + text.slice(1), flat = text.slice(0, 1) + text.slice(1);
  flat.charCodeAt(0);
  const padded = "<" + text + ">", part = padded.slice(1, 1 + text.length);
  const parsed = JSON.parse(JSON.stringify({ v: text, ["k" + text]: 1 }));
  const key = Object.keys(parsed)[1].slice(1), wide = ("\u0416" + text).slice(1), joined = [text.slice(0, 1), text.slice(1)].join("");
  return [text, rope, flat, part, parsed.v, key, wide, joined, String(text), text + "", `${text}`, Symbol.for(text).description];
}
const names = ["written", "a rope", "a concatenation read once", "a slice", "out of JSON.parse", "a slice of a key", "a slice of 16 bits", "joined", "String()", "+ nothing", "a template", "a symbol's description"];
const texts = ["b", "text", "a longer one!", "c", "texu", "a longer one?", "", "bb", "B", "tex", "texts", "\u0416", "te\u0416t"];
const asValue = (s) => s === "text";
const onTheLeft = (s) => s === "text";
const isNot = (s) => s !== "text";
const branched = (s) => {
  if (s === "text")
    return 1;
  return 2;
};
const one = (s) => {
  if (s === "b")
    return 1;
  return 2;
};
const long = (s) => {
  if (s === "a longer one!")
    return 1;
  return 2;
};
const chain = (s) => {
  if (s === "b")
    return 1;
  else if (s === "text")
    return 2;
  else if (s === "texu")
    return 3;
  return 4;
};
const chosen = (s) => {
  switch (s) {
    case "text":
      return 1;
    case "bb":
      return 2;
    case "a longer one!":
      return 3;
    case "":
      return 4;
    default:
      return 5;
  }
};
const starts = (s) => (s.startsWith("te") ? "s" : "-") + (s.endsWith("xt") ? "e" : "-") + s.slice(1, 3) + "|" + s.substring(2) + "|" + s.slice(-2);
const truth = (s) => s ? 1 : 0;
const ofString = [asValue, onTheLeft, isNot, branched, one, long, chain, chosen, starts, truth];
const maybeValue = (r) => r.maybe === "text";
const maybeBranched = (r) => {
  if (r.maybe === "text")
    return 1;
  return 2;
};
const field = (r) => {
  if (r.kind === "text")
    return 1;
  return 2;
};
const anyValue = (r) => r.any === "text";
const anyBranched = (r) => {
  if (r.any === "text")
    return 1;
  else if (r.any === "b")
    return 2;
  return 3;
};
const anyNot = (r) => r.any !== "text";
const anyTruth = (r) => r.any ? 1 : 0;
const notTruth = (r) => !r.any;
const ofRecord = [maybeValue, maybeBranched, field, anyValue, anyBranched, anyNot, anyTruth, notTruth];
let rows = 0;
for (let turn = 0;turn < 2; turn++) {
  for (let t = 0;t < texts.length; t++) {
    const list = made(texts[t]);
    for (let k = 0;k < names.length; k++) {
      let line = "";
      for (let f = 0;f < ofString.length; f++)
        line += " " + ofString[f](list[k]);
      const r = { kind: list[k], maybe: list[k], any: list[k] };
      for (let f = 0;f < ofRecord.length; f++)
        line += " " + ofRecord[f](r);
      line += " " + asValue(list[k]) + branched(list[k]) + chain(list[k]) + anyValue(r) + anyBranched(r);
      rows++;
      console.log(JSON.stringify(texts[t]) + " " + names[k] + " ->" + line);
    }
  }
  const others = [0, 1, -0, NaN, 1.5, null, undefined, true, false, {}, [], ["text"], Symbol("text"), 10n, 0n, new String("text"), () => "text", /text/, new Date(0), { toString() {
    return "text";
  } }];
  for (let k = 0;k < others.length; k++) {
    const r = { kind: "text", maybe: k & 1 ? undefined : null, any: others[k] };
    let line = "";
    for (let f = 0;f < ofRecord.length; f++)
      line += " " + ofRecord[f](r);
    rows++;
    console.log("other " + k + " ->" + line);
  }
  const nils = [undefined, null];
  for (const nil of nils) {
    rows++;
    console.log("nil -> " + asValue(nil) + " " + onTheLeft(nil) + " " + isNot(nil) + " " + branched(nil) + " " + chain(nil) + " " + chosen(nil) + " " + truth(nil));
  }
}
console.log(rows + " rows");
