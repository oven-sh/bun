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

class WithAccessors {
  kept = 1;
  get size(): number {
    log.push("get");
    return this.kept;
  }
  set size(value: number) {
    log.push("set " + value);
    this.kept = value;
  }
  twice(): number {
    return this.size * 2;
  }
}

class WithField {
  size = 1;
  twice(): number {
    return this.size * 2;
  }
}

interface FieldLike {
  size: number;
  twice(): number;
}

interface AccessorLike {
  get size(): number;
  set size(value: number);
  twice(): number;
}

function saidToHaveAField(): new () => FieldLike {
  return WithAccessors;
}

function saidToHaveAccessors(): new () => AccessorLike {
  return WithField;
}

class FieldOverAccessors extends saidToHaveAField() {
  size = 5;
}

class AccessorsOverField extends saidToHaveAccessors() {
  get size(): number {
    log.push("child get");
    return 50;
  }
  set size(value: number) {
    log.push("child set " + value);
  }
}

function logged(label: string, run: () => unknown): void {
  log.length = 0;
  attempt(label, run);
  console.log("  [" + log.join(", ") + "]");
}

logged("a field over accessors", () => {
  const o = new FieldOverAccessors();
  return [o.size, o.twice(), Object.keys(o).join(), JSON.stringify(o)];
});
logged("a field over accessors, stored to", () => {
  const o = new FieldOverAccessors();
  o.size = 9;
  return [o.size, o.twice(), JSON.stringify(o)];
});
logged("accessors over a field", () => {
  const o = new AccessorsOverField();
  return [o.size, o.twice(), Object.keys(o).join(), JSON.stringify(o)];
});
logged("accessors over a field, stored to", () => {
  const o = new AccessorsOverField();
  o.size = 9;
  return [o.size, o.twice(), JSON.stringify(o)];
});
logged("the bases themselves", () => [new WithAccessors().twice(), new WithField().twice()]);
