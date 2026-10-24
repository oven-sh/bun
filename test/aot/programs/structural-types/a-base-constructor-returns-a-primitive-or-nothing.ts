function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

class Plain {
  base = 1;
}

function returning(value: unknown): new () => Plain {
  function Old(this: Plain): unknown {
    this.base = 5;
    return value;
  }
  Old.prototype = Plain.prototype;
  const bag: object = { Old };
  return Reflect.get(bag, "Old");
}

for (const [label, value] of [["undefined", undefined], ["null", null], ["a number", 5], ["a string", "text"], ["an object", { other: true }]] satisfies [string, unknown][]) {
  class Derived extends returning(value) {
    extra = 2;
  }
  const made = new Derived();
  console.log(label + ": " + describe(made) + " instance " + (made instanceof Derived));
}
