const seen: string[] = [];

function mark(label: string) {
  seen.push("evaluated " + label);
  return function (target: unknown, context: DecoratorContext): void {
    seen.push("applied " + label + " to " + context.kind + " " + String(context.name) + (context.kind !== "class" && context.static ? " (static)" : ""));
    context.addInitializer(function () {
      seen.push("initializer of " + label);
    });
  };
}

@mark("class one")
@mark("class two")
class Meter {
  @mark("field") amount = (seen.push("the field's own initializer"), 2);
  @mark("static field") static shared = 1;
  @mark("method")
  read(): number {
    return this.amount;
  }
  @mark("static method")
  static make(): Meter {
    return new Meter();
  }
  @mark("getter")
  get twice(): number {
    return this.amount * 2;
  }
  @mark("private method")
  #hidden(): number {
    return 1;
  }
  constructor() {
    seen.push("constructor body " + this.#hidden());
  }
}

console.log("after the definition:");
for (const line of seen) console.log("  " + line);
seen.length = 0;
const made = Meter.make();
console.log("after one construction:");
for (const line of seen) console.log("  " + line);
console.log("members: " + made.amount + " " + made.read() + " " + made.twice + " " + Meter.shared + " keys [" + Object.keys(made).join(" ") + "]");
