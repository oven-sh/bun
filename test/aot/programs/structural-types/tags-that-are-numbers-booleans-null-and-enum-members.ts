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

enum Kind {
  Dog,
  Cat,
}

type Pet = { kind: Kind.Dog; legs: number } | { kind: Kind.Cat; lives: string };
type Result = { ok: true; value: number } | { ok: false; error: string };
type Versioned = { version: 0; old: string } | { version: 1; fresh: number };
type Maybe = { rest: null; last: number } | { rest: { n: number }; more: string };

function petNumber(p: Pet): number {
  return p.kind === Kind.Dog ? p.legs + 1 : p.lives.length;
}

function unwrap(r: Result): number {
  return r.ok ? r.value + 1 : -r.error.length;
}

function unwrapNegated(r: Result): number {
  if (!r.ok) return -r.error.length;
  return r.value + 1;
}

function read(v: Versioned): number {
  switch (v.version) {
    case 0:
      return v.old.length;
    case 1:
      return v.fresh + 1;
  }
}

function tail(m: Maybe): number {
  return m.rest === null ? m.last + 1 : m.rest.n + m.more.length;
}

attempt("honest", () => [petNumber({ kind: Kind.Dog, legs: 4 }), petNumber({ kind: Kind.Cat, lives: "nine" }), unwrap({ ok: true, value: 1 }), unwrap({ ok: false, error: "bad" }), unwrapNegated({ ok: true, value: 1 }), read({ version: 0, old: "old" }), read({ version: 1, fresh: 1 }), tail({ rest: null, last: 1 }), tail({ rest: { n: 1 }, more: "m" })]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += petNumber(i & 1 ? { kind: Kind.Dog, legs: i } : { kind: Kind.Cat, lives: "nine" }) + unwrap(i & 1 ? { ok: true, value: i } : { ok: false, error: "e" }) + read(i & 1 ? { version: 0, old: "o" } : { version: 1, fresh: i }) + tail({ rest: null, last: i });
console.log("2000 honest rounds", warm);

attempt("a number forges the tag of a dog", () => {
  const n: number = 1;
  const tag: Kind.Dog = n;
  return petNumber({ kind: tag, legs: 4 });
});
attempt("a number forges the tag of a cat", () => {
  const n: number = 0;
  const tag: Kind.Cat = n;
  return petNumber({ kind: tag, lives: "nine" });
});
attempt("a number outside the enum as a tag", () => {
  const n: number = 7;
  const tag: Kind.Dog = n;
  return petNumber({ kind: tag, legs: 4 });
});
attempt("a fraction and NaN as tags", () => {
  const half: number = 0.5;
  const nan: number = NaN;
  const a: Kind.Dog = half;
  const b: Kind.Dog = nan;
  return [a, b].map(tag => {
    try {
      return petNumber({ kind: tag, legs: 4 });
    } catch (error) {
      return error instanceof Error ? error.constructor.name : "other";
    }
  });
});
attempt("negative zero as the tag 0", () => [read({ version: -0, old: "old" }), petNumber({ kind: -0, legs: 4 })]);
attempt("ok is flipped through a wider view", () => {
  const r: Result = [{ ok: true, value: 1 } satisfies Result][0];
  const open: { ok: boolean } = r;
  open.ok = false;
  return unwrap(r);
});
attempt("ok is flipped the other way", () => {
  const r: Result = [{ ok: false, error: "bad" } satisfies Result][0];
  const open: { ok: boolean } = r;
  open.ok = true;
  return [unwrap(r), unwrapNegated(r)];
});
attempt("the version is raised through a wider view", () => {
  const v: Versioned = [{ version: 0, old: "old" } satisfies Versioned][0];
  const open: { version: number } = v;
  open.version = 1;
  const first = read(v);
  open.version = 2;
  return [first, read(v), typeof read(v)];
});
attempt("rest is cleared through a wider view", () => {
  const m: Maybe = [{ rest: { n: 1 }, more: "m" } satisfies Maybe][0];
  const open: { rest: { n: number } | null } = m;
  open.rest = null;
  return tail(m);
});
attempt("rest is filled through a wider view", () => {
  const m: Maybe = [{ rest: null, last: 1 } satisfies Maybe][0];
  const open: { rest: { n: number } | null } = m;
  open.rest = { n: 5 };
  return tail(m);
});
attempt("honest again", () => [petNumber({ kind: Kind.Dog, legs: 4 }), unwrap({ ok: true, value: 1 }), read({ version: 1, fresh: 1 }), tail({ rest: null, last: 1 })]);
