function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

type HasLength = { length: number };

function pick(which: number): HasLength {
  if (which === 0) return { length: 10 };
  if (which === 1) return "four";
  if (which === 2) return [1, 2, 3];
  if (which === 3) return pick;
  if (which === 4) return new Float64Array(5);
  if (which === 5) return "";
  return { length: which };
}

function throughALocal(which: number): number {
  const local: HasLength = pick(which);
  return local.length;
}

function throughALocalThatChanges(): string[] {
  let local: HasLength = { length: 1 };
  const seen: string[] = [];
  for (let i = 0; i < 8; i++) {
    seen.push(typeof local + " " + local.length);
    local = pick(i);
  }
  seen.push(typeof local + " " + local.length);
  return seen;
}

function chosenByACondition(flag: boolean): number {
  const local: HasLength = flag ? { length: 100 } : "no";
  return local.length;
}

function holder(start: HasLength) {
  let held = start;
  return {
    read: (): number => held.length,
    kind: (): string => typeof held,
    replace(next: HasLength): void {
      held = next;
    },
  };
}

let shared: HasLength = { length: 0 };
function readShared(): number {
  return shared.length;
}
function kindOfShared(): string {
  return typeof shared;
}

let warm = 0;
const warmHolder = holder({ length: 0 });
for (let i = 0; i < 2000; i++) {
  warm += throughALocal(6 + (i & 3));
  warmHolder.replace({ length: i });
  warm += warmHolder.read();
  shared = { length: i };
  warm += readShared();
}
console.log("after 2000 literals", warm);

for (let which = 0; which < 7; which++) {
  attempt("result " + which, () => pick(which).length);
  attempt("typeof result " + which, () => typeof pick(which));
  attempt("local " + which, () => throughALocal(which));
  attempt("captured " + which, () => {
    warmHolder.replace(pick(which));
    return [warmHolder.kind(), warmHolder.read()];
  });
  attempt("captured from the start " + which, () => {
    const fresh = holder(pick(which));
    return [fresh.kind(), fresh.read()];
  });
  attempt("module variable " + which, () => {
    shared = pick(which);
    return [kindOfShared(), readShared()];
  });
}
attempt("a local that changes", throughALocalThatChanges);
attempt("chosen by a condition: true", () => chosenByACondition(true));
attempt("chosen by a condition: false", () => chosenByACondition(false));
