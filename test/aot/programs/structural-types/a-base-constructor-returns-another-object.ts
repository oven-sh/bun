function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

class Swapped {
  own = "own field";
  constructor(replacement: Swapped | undefined) {
    if (replacement !== undefined) return replacement;
  }
}

class Derived extends Swapped {
  extra = "field of the subclass";
  hello(): string {
    return "hello " + this.extra;
  }
}

const honest = new Derived(undefined);
console.log("honest: " + describe(honest) + " " + honest.hello() + " " + (honest instanceof Derived));

const target: Swapped = { own: "a literal" };
const made = new Derived(target);
console.log("same object: " + (Object.is(made, target)));
console.log("made: " + describe(made));
console.log("target: " + describe(target));
console.log("instance: " + (made instanceof Derived) + " " + (made instanceof Swapped));
console.log("extra: " + made.extra + " " + typeof made.hello);

const again = new Derived(honest);
console.log("an earlier instance: " + Object.is(again, honest) + " " + describe(again) + " " + again.hello());
