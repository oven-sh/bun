function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

const four = 4;
const on = "on";
const yes = true;

function double(n: 4): number {
  return n * 2;
}

function isOn(mode: "on"): string {
  return mode === "on" ? "on" : "never";
}

function modeLength(mode: "on"): number {
  return mode.length;
}

class Fixed {
  readonly n = 4;
  readonly mode = "on";
  readonly flag = true;
  twice(): number {
    return this.n * 2;
  }
  label(): string {
    return this.mode + ":" + this.mode.length + ":" + (this.flag ? "yes" : "no");
  }
}

interface Config {
  readonly depth: 3;
  readonly name: "config";
}

function depthPlus(c: Config): number {
  return c.depth + 1;
}

function nameOf(c: Config): string {
  return c.name === "config" ? "config" : "never";
}

attempt("honest", () => [double(four), double(4), isOn(on), modeLength("on"), new Fixed().twice(), new Fixed().label(), depthPlus({ depth: 3, name: "config" }), nameOf({ depth: 3, name: "config" })]);
attempt("a const copied into a let is a number", () => {
  let n = four;
  n = 5;
  let mode = on;
  mode = "off";
  let flag = yes;
  flag = false;
  return [n, mode, flag, four, on, yes];
});
let warm = 0;
for (let i = 0; i < 2000; i++) warm += double(four) + modeLength(on) + new Fixed().twice() + depthPlus({ depth: 3, name: "config" });
console.log("2000 honest rounds", warm);

attempt("a read-only literal field is stored to through a mutable view", () => {
  const f = new Fixed();
  const open: { n: number; mode: string; flag: boolean } = f;
  open.n = 10;
  open.mode = "offline";
  open.flag = false;
  return [f.n, f.twice(), f.mode, f.label(), double(f.n), isOn(f.mode), modeLength(f.mode)];
});
attempt("a literal member is stored to through a wider view", () => {
  const c: { depth: 3; name: "config" } = { depth: 3, name: "config" };
  const open: { depth: number; name: string } = c;
  open.depth = 30;
  open.name = "other";
  return [c.depth, depthPlus(c), c.name, nameOf(c), c.depth === 3, c.name === "config"];
});
attempt("a literal element is stored to through a wider view", () => {
  const list: 4[] = [4, 4];
  const open: number[] = list;
  open[0] = 40;
  open.push(400);
  return [list.map(double), list[0] === 4];
});
attempt("a literal in a tuple", () => {
  const pair: [4, "on"] = [4, "on"];
  const open: [number, string] = pair;
  open[0] = 1.5;
  open[1] = "";
  return [double(pair[0]), isOn(pair[1]), modeLength(pair[1])];
});
attempt("true is stored over", () => {
  const o: { ok: true } = { ok: true };
  const open: { ok: boolean } = o;
  open.ok = false;
  return [o.ok, o.ok ? "yes" : "no", o.ok === true, !o.ok];
});
attempt("the length of a tuple", () => {
  const pair: [number, number] = [1, 2];
  pair.push(3);
  const two: 2 = pair.length;
  pair.pop();
  pair.pop();
  const stillTwo: 2 = pair.length;
  return [two, stillTwo, two === 2, pair.length === 2];
});
attempt("a captured literal", () => {
  const box: { n: 4 } = { n: 4 };
  const read = () => double(box.n);
  const open: { n: number } = box;
  const before = read();
  open.n = -0;
  return [before, read(), 1 / box.n];
});
attempt("null and undefined as literal types", () => {
  const o: { gone: null; missing: undefined } = { gone: null, missing: undefined };
  const open: { gone: object | null; missing: number | undefined } = o;
  open.gone = {};
  open.missing = 5;
  return [o.gone === null, o.missing === undefined, typeof o.gone, typeof o.missing, o.gone ?? "defaulted", o.missing ?? "defaulted"];
});
attempt("a template literal type", () => {
  const o: { id: `id-${number}` } = { id: "id-1" };
  const open: { id: string } = o;
  open.id = "no";
  return [o.id, o.id.startsWith("id-"), o.id.slice(3)];
});
attempt("honest again", () => [double(four), isOn(on), new Fixed().twice(), new Fixed().label()]);
