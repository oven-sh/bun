// charCodeAt at integer positions that nothing puts inside the string: the code unit is used as an integer by comparisons, a switch, arithmetic and bit operations, and outside the string every one of them sees NaN.
const opaque = new Function("value", "return value") as <T>(value: T) => T;
const flat = (text: string): string => opaque(text.split("").join(""));
const rope = (text: string): string => (text.length < 2 ? flat(text) : flat(text.slice(0, 1)) + flat(text.slice(1)));
const wide = (text: string): string => flat(text + "☃").replace("☃", "");
const makers = [flat, rope, wide];

function kindAt(s: string, i: number): string {
  const unit = s.charCodeAt(i | 0);
  if (unit === 47) return "slash";
  if (unit >= 48 && unit <= 57) return "digit" + (unit - 48);
  if (unit < 33) return "space";
  if (unit !== unit) return "outside";
  return "other" + unit;
}

function switchAt(s: string, i: number): number {
  switch (s.charCodeAt(i | 0)) {
    case 47: return 1;
    case 92: return 2;
    case 48: return 3;
    case 9731: return 4;
    default: return 0;
  }
}

function arithmeticAt(s: string, i: number): string {
  const unit = s.charCodeAt(i | 0);
  return [unit + 1, unit * 2, unit - 0.5, unit | 0, unit & 15, unit >>> 1, unit ^ 255, -unit, unit / 2, unit % 7, `${unit}`, unit == null, typeof unit, Math.max(unit, 3), isNaN(unit)].join(" ");
}

function lookAround(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const before = s.charCodeAt(i - 1);
    const after = s.charCodeAt(i + 1);
    if (before === 47 && after === 47) out += "b";
    else if (after === 47) out += "a";
    else if (before !== before) out += "<";
    else if (!(after >= 0)) out += ">";
    else out += ".";
  }
  return out;
}

function hash(s: string, from: number, count: number): number {
  let h = 17;
  for (let i = from | 0; i < ((from + count) | 0); i++) h = (Math.imul(h, 31) ^ s.charCodeAt(i)) | 0;
  return h;
}

function chain(s: string, i: number): number {
  let k = s.charCodeAt(i & 7);
  k = s.charCodeAt(k & 3);
  k = s.charCodeAt((k | 0) - 96);
  return k;
}

function kept(s: string, i: number): number[] {
  const units = [s.charCodeAt(i | 0), s.charCodeAt((i + 1) | 0)];
  return units;
}

function underHandler(s: string | null, i: number): string {
  try {
    const unit = (s as string).charCodeAt(i | 0);
    return unit > 96 ? "letter" : "no " + unit;
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

const texts = ["", "/", "a/b", "//", "0 9\\", "ab☃/", "abcdefgh", "\0\t"];
const places = [0, 1, 2, 3, 4, 7, 8, 100, -1, -2, -100, 2147483647, -2147483648];
for (const text of texts) {
  for (const make of makers) {
    console.log(JSON.stringify(text), make.name, places.map(place => kindAt(make(text), place)).join(","), places.map(place => switchAt(make(text), place)).join(""));
    console.log(lookAround(make(text)), places.slice(0, 9).map(place => hash(make(text), place, 3)).join(","), places.map(place => chain(make(text), place)).join(","));
    console.log(places.slice(0, 10).map(place => kept(make(text), place).join("/")).join(" "), places.slice(0, 4).map(place => underHandler(make(text), place)).join(","));
  }
  console.log(arithmeticAt(text, 0), "|", arithmeticAt(text, text.length), "|", arithmeticAt(text, -1));
}
console.log(underHandler(null, 0));
