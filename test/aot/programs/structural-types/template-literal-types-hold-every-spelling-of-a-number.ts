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

type Id = `id-${number}`;
type Size = `${number}px`;
type Switch = `is-${boolean}`;
type Big = `${bigint}n`;

function make(n: number): Id {
  return `id-${n}`;
}
function numberOf(id: Id): number {
  return Number(id.slice(3));
}
function pixels(size: Size): number {
  return parseFloat(size);
}
function isOn(value: Switch): boolean {
  return value === "is-true";
}
function isId(text: string): text is Id {
  return text.startsWith("id-") && text.length > 3 && !Number.isNaN(Number(text.slice(3)));
}

const table: Record<Id, number> = {};
function remember(id: Id, n: number): number {
  table[id] = n;
  return table[id];
}

const numbers: number[] = [0, -0, 1, 1.5, -1, NaN, Infinity, -Infinity, 1e21, 1e-7, 2 ** 31, 2 ** 53, 0xff, 1_000];
for (const n of numbers) {
  attempt(show(n), () => {
    const id = make(n);
    const size: Size = `${n}px`;
    return [id, id.length, numberOf(id), remember(id, n), size, pixels(size)];
  });
}
attempt("the table", () => [Object.keys(table), JSON.stringify(table)]);
attempt("a key that was never stored", () => {
  const missing: Id = "id-404";
  const held: number = table[missing];
  return [held, held + 1, typeof held, missing in table];
});
attempt("switches", () => {
  const flags: boolean[] = [true, false];
  const made: Switch[] = flags.map((flag): Switch => `is-${flag}`);
  return [made, made.map(isOn)];
});
attempt("bigints", () => {
  const values: bigint[] = [0n, -0n, -5n, 2n ** 64n];
  const made: Big[] = values.map((value): Big => `${value}n`);
  return made;
});
attempt("texts that a guard lets in", () =>
  ["id-1", "id- 1", "id-0x10", "id-1e3", "id-", "id--0", "id-Infinity", "id-1n", "id-١", "ID-1", "id-\n2"].map(text => (isId(text) ? [text, numberOf(text)] : "no: " + text)),
);
attempt("written out", () => {
  const ids: Id[] = ["id-1", "id-1.50", "id-1e3", "id-0x1F", "id--0", "id-+1", "id-.5", "id-5."];
  return ids.map(numberOf);
});
