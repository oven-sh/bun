function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

function kind(error: unknown): string {
  return error instanceof ReferenceError ? "a ReferenceError" : error instanceof TypeError ? "a TypeError" : "something else";
}

class Point {
  x = 1;
  y = 2;
  sum(): number {
    return this.x + this.y;
  }
}

function Odd(Base: new () => Point, how: string) {
  return class extends Base {
    constructor() {
      if (how === "twice") {
        super();
        super();
      } else if (how === "never") {
        return;
      } else if (how === "never, an object is returned") {
        return new Point();
      } else if (how === "in a finally") {
        try {
          how.length;
        } finally {
          super();
        }
      } else {
        super();
      }
    }
  };
}

for (const how of ["at once", "twice", "never", "never, an object is returned", "in a finally"]) {
  try {
    const made = new (Odd(Point, how))();
    console.log(how + ": " + describe(made) + " sum " + made.sum());
  } catch (error) {
    console.log(how + ": threw " + kind(error));
  }
}
