import * as core from "core";
import * as loose from "loose";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

const log: string[] = [];

class Base {
  declare level: number;
}
Object.defineProperty(Base.prototype, "level", {
  set(value: number) {
    log.push("main: the setter of the base got " + value);
  },
  get() {
    return -1;
  },
});

class Heir extends Base {
  level = 5;
}

class Declared {
  first: number | undefined;
  second = 2;
  third: string | undefined;
}

attempt("fields without a value, in the project that assigns", () => [Object.keys(core.make()).join(), "first" in core.make(), JSON.stringify(core.make())]);
attempt("fields without a value, in the project that defines", () => [Object.keys(loose.make()).join(), "first" in loose.make(), JSON.stringify(loose.make())]);
attempt("fields without a value, here", () => [Object.keys(new Declared()).join(), "first" in new Declared()]);
attempt("a field over an accessor, in the project that assigns", () => {
  const heir = new core.Heir();
  return [heir.level, Object.keys(heir).join(), core.log.join("; ")];
});
attempt("a field over an accessor, in the project that defines", () => {
  const heir = new loose.Heir();
  return [heir.level, Object.keys(heir).join(), loose.log.join("; ")];
});
attempt("a field over an accessor, here", () => {
  const heir = new Heir();
  return [heir.level, Object.keys(heir).join(), log.join("; ")];
});
attempt("a subclass here of a class there", () => {
  class Local extends core.Declared {
    fourth: number | undefined;
    fifth = 5;
  }
  class Other extends loose.Declared {
    fourth: number | undefined;
    fifth = 5;
  }
  return [Object.keys(new Local()).join(), Object.keys(new Other()).join()];
});
let warm = 0;
for (let i = 0; i < 2000; i++) warm += core.make().second + loose.make().second + new Declared().second + new core.Heir().level + new loose.Heir().level;
console.log("2000 rounds: " + warm);
