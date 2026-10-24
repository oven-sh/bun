function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

class Swapped {
  constructor(replacement: object) {
    return replacement;
  }
}

class Derived extends Swapped {
  extra = 1;
}

for (const [label, target] of [["frozen", Object.freeze({ kept: 1 })], ["sealed", Object.seal({ kept: 1 })], ["not extensible", Object.preventExtensions({ kept: 1 })], ["open", { kept: 1 }]] satisfies [string, object][]) {
  try {
    console.log(label + ": " + describe(new Derived(target)));
  } catch (error) {
    console.log(label + ": threw a TypeError: " + (error instanceof TypeError) + " " + describe(target));
  }
}
