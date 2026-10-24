class Greeter {
  name = "greeter";
  greet(): string {
    return "hello from " + this.name;
  }
  twice(): string {
    return this.greet() + " and " + this.greet();
  }
  get title(): string {
    return "title of " + this.name;
  }
}

function greet(g: Greeter): string {
  return g.greet();
}

function both(g: Greeter): string {
  return g.greet() + " / " + g.twice() + " / " + g.title;
}

const untouched = new Greeter();
const shadowed = new Greeter();

let last = "";
for (let i = 0; i < 2000; i++) last = greet(untouched) + greet(shadowed);
console.log("2000 honest calls, the last: " + last);

shadowed.greet = () => "own arrow";
console.log("an own member hides the method: " + both(shadowed));
console.log("own now: " + Object.hasOwn(shadowed, "greet") + " keys " + Object.keys(shadowed).join());
console.log("the other instance: " + both(untouched));

shadowed.greet = function () {
  return "own function of " + this.name;
};
console.log("an own function sees this: " + both(shadowed));

const original = Greeter.prototype.greet;
Greeter.prototype.greet = function () {
  return "patched " + this.name;
};
console.log("the prototype's method replaced: " + both(untouched));
console.log("an instance made afterwards: " + both(new Greeter()));
console.log("the shadowed one keeps its own: " + both(shadowed));

Greeter.prototype.greet = original;
console.log("put back: " + both(untouched));

Object.defineProperty(Greeter.prototype, "title", {
  get() {
    return "patched title";
  },
  configurable: true,
});
console.log("the getter replaced: " + both(untouched));

Object.defineProperty(untouched, "title", { value: "own title", configurable: true });
console.log("an own value hides the getter: " + both(untouched));
console.log("another instance: " + new Greeter().title);

class Loud extends Greeter {
  greet(): string {
    return super.greet().toUpperCase();
  }
}

const loud: Greeter = new Loud();
console.log("a subclass: " + both(loud));
Greeter.prototype.greet = () => "arrow on the base";
console.log("the base replaced under super: " + both(loud));
Greeter.prototype.greet = original;

const swapping = new Greeter();
const trace: string[] = [];
for (let i = 0; i < 6; i++) {
  trace.push(swapping.greet());
  if (i === 1) swapping.greet = () => "swapped";
  if (i === 3) Reflect.deleteProperty(swapping, "greet");
}
console.log("replaced and uncovered inside a loop: " + trace.join(", "));

const list: Greeter[] = [untouched, shadowed, loud, swapping];
console.log("elements: " + list.map(greet).join(", "));

export {};
