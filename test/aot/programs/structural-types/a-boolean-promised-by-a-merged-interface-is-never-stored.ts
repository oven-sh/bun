function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Door {
  open: boolean;
}
class Door {
  id: number = 1;
  state(): string {
    return this.open ? "open" : "shut";
  }
  flipped(): boolean {
    return !this.open;
  }
}

function word(flag: boolean): string {
  return flag ? "true" : "false";
}

function openOf(door: Door): boolean {
  return door.open;
}

const door = new Door();
show("read", () => door.open);
show("typeof", () => typeof door.open);
show("as a condition", () => (door.open ? "yes" : "no"));
show("not", () => !door.open);
show("not not", () => !!door.open);
show("equals false", () => door.open === false);
show("equals true", () => door.open === true);
show("differs from true", () => door.open !== true);
show("equals undefined", () => door.open === undefined);
show("loosely equals false", () => door.open == false);
show("and", () => door.open && "right");
show("or", () => door.open || "right");
show("or by ??", () => door.open ?? "right");
show("as a number", () => Number(door.open));
show("plus", () => +door.open);
show("to a whole number", () => Number(door.open) | 0);
show("String", () => String(door.open));
show("toString", () => door.open.toString());
show("in a method", () => door.state());
show("flipped in a method", () => door.flipped());
show("through a function", () => openOf(door));
show("given to a typed function", () => word(door.open));
show("a typed element", () => {
  const list: boolean[] = [door.open, true];
  return list;
});
show("counted", () => [door, door].filter(d => d.open === false).length);
show("in a switch", () => {
  switch (door.open) {
    case true:
      return "true";
    case false:
      return "false";
    default:
      return "neither";
  }
});
show("keys", () => Object.keys(door));
show("JSON", () => JSON.stringify(door));
