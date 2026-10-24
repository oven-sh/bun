function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(text).join(", ") + "]";
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

const log: string[] = [];

abstract class FieldPromised {
  abstract size: number;
  twice(): number {
    return this.size * 2;
  }
  reset(): void {
    this.size = 0;
  }
}

class WithAccessors extends FieldPromised {
  kept = 5;
  get size(): number {
    log.push("get");
    return this.kept;
  }
  set size(value: number) {
    log.push("set " + value);
    this.kept = value + 100;
  }
}

class WithField extends FieldPromised {
  size = 5;
}

abstract class AccessorsPromised {
  abstract get size(): number;
  abstract set size(value: number | string);
  twice(): number {
    return this.size * 2;
  }
  fill(): void {
    this.size = "text";
  }
}

class KeepsItsPromise extends AccessorsPromised {
  kept = 5;
  get size(): number {
    return this.kept;
  }
  set size(value: number | string) {
    this.kept = typeof value === "string" ? value.length : value;
  }
}

class AFieldInstead extends AccessorsPromised {
  size = 5;
}

function logged(label: string, run: () => unknown): void {
  log.length = 0;
  attempt(label, run);
  if (log.length > 0) console.log("  " + log.join(", "));
}

logged("a field was promised, accessors came", () => {
  const o = new WithAccessors();
  const before = o.twice();
  o.reset();
  return [before, o.size, o.twice(), Object.keys(o).join(), JSON.stringify(o)];
});
logged("a field was promised, a field came", () => {
  const o = new WithField();
  const before = o.twice();
  o.reset();
  return [before, o.size, o.twice(), Object.keys(o).join(), JSON.stringify(o)];
});
logged("accessors were promised, accessors came", () => {
  const o = new KeepsItsPromise();
  const before = o.twice();
  o.fill();
  return [before, o.size, o.size + 1, o.twice(), Object.keys(o).join()];
});
logged("accessors were promised, a number field came", () => {
  const o = new AFieldInstead();
  const before = o.twice();
  o.fill();
  return [before, o.size, o.size + 1, o.twice(), Object.keys(o).join(), JSON.stringify(o)];
});
logged("both kinds at one site", () => {
  const all: FieldPromised[] = [new WithField(), new WithAccessors(), new WithField()];
  return all.map(o => (o.reset(), [o.size, o.twice()]));
});
logged("both kinds at the other site", () => {
  const all: AccessorsPromised[] = [new KeepsItsPromise(), new AFieldInstead(), new KeepsItsPromise()];
  return all.map(o => (o.fill(), [o.size, o.twice()]));
});
let sum = 0;
for (let i = 0; i < 2000; i++) {
  const o: FieldPromised = i % 2 === 0 ? new WithField() : new WithAccessors();
  o.size = i;
  sum += o.twice();
}
console.log("2000 rounds: " + sum);
