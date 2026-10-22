function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
}

interface Size {
  width: number;
  scale: number;
  unit: string;
}

function blankWidth(): string {
  const full: Size = { width: 2, scale: 0.5, unit: "m" };
  const change: Partial<Size> = { width: undefined };
  const merged: Size = { ...full, ...change };
  return typeof merged.width + " " + show(merged.width) + " " + show(merged.width + 1) + " " + show(merged.width * merged.scale) + " " + show(merged.width | 0) + " " + Object.keys(merged).join() + " " + JSON.stringify(merged);
}

function blankScale(): string {
  const full: Size = { width: 2, scale: 0.5, unit: "m" };
  const change: Partial<Size> = { scale: undefined };
  const merged: Size = { ...full, ...change };
  return typeof merged.scale + " " + show(merged.scale + 1) + " " + show(merged.width * merged.scale) + " " + JSON.stringify(merged);
}

function blankUnit(): string {
  const full: Size = { width: 2, scale: 0.5, unit: "m" };
  const change: Partial<Size> = { unit: undefined };
  const merged: Size = { ...full, ...change };
  let upper: string;
  try {
    upper = merged.unit.toUpperCase();
  } catch (error) {
    upper = "threw " + (error instanceof TypeError);
  }
  return typeof merged.unit + " " + show(merged.unit + "!") + " " + upper + " " + JSON.stringify(merged);
}

function forgotten(): string {
  const wide = { width: "wide", extra: true };
  const onlyExtra: { extra: boolean } = wide;
  const full = { width: 2, extra: false };
  const merged: { width: number; extra: boolean } = { ...full, ...onlyExtra };
  return typeof merged.width + " " + show(merged.width + 1) + " " + show(merged.width * 2) + " " + JSON.stringify(merged);
}

function omitted(): string {
  const full: Size = { width: 2, scale: 0.5, unit: "m" };
  const rest: Omit<Size, "width"> = full;
  const merged: { width: string; scale: number; unit: string } = { width: "text", ...rest };
  let upper: string;
  try {
    upper = merged.width.toUpperCase();
  } catch (error) {
    upper = "threw " + (error instanceof TypeError);
  }
  return typeof merged.width + " " + show(merged.width + "!") + " " + show(merged.width.length) + " " + upper + " " + JSON.stringify(merged);
}

function assigned(): string {
  const full: Size = { width: 2, scale: 0.5, unit: "m" };
  const change: Partial<Size> = { width: undefined, scale: undefined };
  Object.assign(full, change);
  return typeof full.width + " " + show(full.width + 1) + " " + show(full.scale * 2) + " " + JSON.stringify(full);
}

function restOfADestructuring(): string {
  const full: Size = { width: 2, scale: 0.5, unit: "m" };
  const narrow: { width: number } = full;
  const { width, ...rest } = narrow;
  return show(width) + " " + Object.keys(rest).join() + " " + JSON.stringify(rest);
}

function honest(i: number): number {
  const full: Size = { width: i, scale: 0.5, unit: "m" };
  const change: Partial<Size> = { width: i + 1 };
  const merged: Size = { ...full, ...change };
  return merged.width * merged.scale + merged.unit.length;
}

let total = 0;
for (let i = 0; i < 2000; i++) total += honest(i);
console.log("2000 honest rounds: " + total);
console.log("width: undefined: " + blankWidth());
console.log("scale: undefined: " + blankScale());
console.log("unit: undefined: " + blankUnit());
console.log("a forgotten member: " + forgotten());
console.log("an omitted member: " + omitted());
console.log("assigned: " + assigned());
console.log("the rest of a destructuring: " + restOfADestructuring());

export {};
