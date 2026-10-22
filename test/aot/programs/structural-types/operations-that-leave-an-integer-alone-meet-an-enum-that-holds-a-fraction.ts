function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return "{" + Object.entries(value).map(([key, held]) => key + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

enum Color {
  Red,
  Green,
  Blue,
}

function bits(c: Color): unknown[] {
  return [c | 0, c >> 0, c >>> 0, ~~c, c & -1, c ^ 0, c << 0, Math.imul(c, 1), Math.clz32(c)];
}

function rounded(c: Color): unknown[] {
  return [Math.floor(c), Math.ceil(c), Math.round(c), Math.trunc(c), Math.abs(c), Math.sign(c), Math.fround(c)];
}

function asked(c: Color): unknown[] {
  return [Number.isInteger(c), Number.isSafeInteger(c), Number.isFinite(c), Number.isNaN(c), isNaN(c), isFinite(c)];
}

function compared(c: Color): unknown[] {
  return [c === c, c == c, c !== c, Object.is(c, 0), Object.is(c, c), c < 1, c <= 0, c >= 0, c >= 0 && c <= 2, c > 2, !(c <= 2)];
}

function unchanged(c: Color): unknown[] {
  return [+c, c * 1, c + 0, c - 0, c / 1, c % 1, c % 4, -c, 1 / c, c ** 1, Math.min(c, 2), Math.max(c, 0)];
}

function written(c: Color): unknown[] {
  return [String(c), c.toString(), `${c}`, "" + c, JSON.stringify(c), JSON.stringify([c]), JSON.stringify({ c }), c.toFixed(1)];
}

function tested(c: Color): unknown[] {
  return [c ? "yes" : "no", !c, !!c, c || "or", c && "and", c ?? "nothing", typeof c];
}

function placed(c: Color): unknown[] {
  return ["abc"[c], "abc".charAt(c), "abc".charCodeAt(c), "abc".slice(c), "abc".at(c), [7, 8, 9][c], [7, 8, 9].at(c), [7, 8, 9].slice(c), [7, 8, 9].indexOf(8, c)];
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const c: Color = i % 3;
  warm += bits(c).length + rounded(c).length + asked(c).length + compared(c).length + unchanged(c).length + written(c).length + tested(c).length + placed(c).length;
}
console.log("2000 honest rounds", warm);

const numbers: number[] = [1, 0.5, 1.5, -0.5, -0, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 32 + 1.5, 2 ** 53, -(2 ** 31) - 1, 1e21, 5e-324];
for (const n of numbers) {
  const c: Color = n;
  const label = show(n);
  attempt(label + " bits", () => bits(c));
  attempt(label + " rounded", () => rounded(c));
  attempt(label + " asked", () => asked(c));
  attempt(label + " compared", () => compared(c));
  attempt(label + " unchanged", () => unchanged(c));
  attempt(label + " written", () => written(c));
  attempt(label + " tested", () => tested(c));
  attempt(label + " placed", () => placed(c));
  attempt(label + " as a bigint", () => BigInt(c));
  attempt(label + " as a length", () => new Array<number>(c).length);
  attempt(label + " as a count", () => "ab".repeat(c).length);
}
