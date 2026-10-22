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

class Shape {
  sides = 4;
}

class Square extends Shape {
  edge = 2;
}

class Machine {
  value: number | string = 1;
  shape: Shape = new Square();
  next: Machine | null = null;
  mode: "on" | "off" = "on";
  #hidden: number | string = 1;
  static shared: number | string = 1;

  spoil(really: boolean): void {
    if (!really) return;
    this.value = "text";
    this.shape = new Shape();
    this.next = null;
    this.mode = "off";
    this.#hidden = "text";
    Machine.shared = "text";
  }

  typeofThis(really: boolean): unknown {
    if (typeof this.value === "number") {
      this.spoil(really);
      return [this.value, this.value + 1, this.value * 2];
    }
    return "other";
  }

  instanceofThis(really: boolean): unknown {
    if (this.shape instanceof Square) {
      this.spoil(really);
      return [this.shape.edge, this.shape.edge * 2, this.shape.sides];
    }
    return "other";
  }

  notNullThis(really: boolean): unknown {
    this.next = new Machine();
    if (this.next !== null) {
      this.spoil(really);
      return this.next.mode;
    }
    return "other";
  }

  literalThis(really: boolean): unknown {
    if (this.mode === "on") {
      this.spoil(really);
      return [this.mode, this.mode === "on", this.mode.length];
    }
    return "other";
  }

  privateThis(really: boolean): unknown {
    if (typeof this.#hidden === "number") {
      this.spoil(really);
      return [this.#hidden, this.#hidden + 1, this.#hidden * 2];
    }
    return "other";
  }

  staticMember(really: boolean): unknown {
    Machine.shared = 1;
    if (typeof Machine.shared === "number") {
      this.spoil(really);
      return [Machine.shared, Machine.shared + 1, Machine.shared * 2];
    }
    return "other";
  }

  inAnArrow(really: boolean): unknown {
    const read = (): unknown => {
      if (typeof this.value === "number") {
        this.spoil(really);
        return [this.value, this.value + 1];
      }
      return "other";
    };
    return read();
  }

  get computed(): unknown {
    if (typeof this.value === "number") {
      this.spoil(true);
      return [this.value, this.value + 1];
    }
    return "other";
  }
}

class Quiet extends Machine {
  spoil(really: boolean): void {}
}

function round(label: string, make: () => Machine, really: boolean): void {
  attempt(label + ": typeof", () => make().typeofThis(really));
  attempt(label + ": instanceof", () => make().instanceofThis(really));
  attempt(label + ": not null", () => make().notNullThis(really));
  attempt(label + ": a literal", () => make().literalThis(really));
  attempt(label + ": a private field", () => make().privateThis(really));
  attempt(label + ": a static member", () => make().staticMember(really));
  attempt(label + ": in an arrow function", () => make().inAnArrow(really));
}

round("honest", () => new Machine(), false);
for (let i = 0; i < 2000; i++) {
  const m = new Machine();
  m.typeofThis(false);
  m.instanceofThis(false);
  m.notNullThis(false);
  m.literalThis(false);
  m.privateThis(false);
  m.staticMember(false);
  m.inAnArrow(false);
}
round("a method stores", () => new Machine(), true);
round("a subclass whose method stores nothing", () => new Quiet(), true);
attempt("inside a getter", () => new Machine().computed);
attempt("inside a getter of the quiet subclass", () => new Quiet().computed);
round("honest again", () => new Machine(), false);
