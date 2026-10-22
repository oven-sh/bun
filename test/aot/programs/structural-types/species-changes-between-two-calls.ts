class Tagged extends Array<number> {
  tag = "tagged";
}

class Switching extends Array<number> {
  static target: ArrayConstructor | typeof Tagged | typeof Switching = Switching;
  static asked = 0;
}

Object.defineProperty(Switching, Symbol.species, {
  get() {
    Switching.asked++;
    return Switching.target;
  },
});

function copy(list: number[]): number[] {
  return list.map(n => n);
}

function describe(list: number[]): string {
  return list.constructor.name + " " + JSON.stringify(list) + " keys " + Object.keys(list).join();
}

const source = new Switching();
source.push(1, 2);

console.log("itself: " + describe(copy(source)));
Switching.target = Array;
console.log("Array: " + describe(copy(source)));
Switching.target = Tagged;
console.log("another subclass: " + describe(copy(source)));
Switching.target = Switching;
console.log("itself again: " + describe(copy(source)));
console.log("asked: " + Switching.asked);

let names = "";
for (let i = 0; i < 6; i++) {
  Switching.target = i % 3 === 0 ? Array : i % 3 === 1 ? Tagged : Switching;
  names += copy(source).constructor.name + " ";
}
console.log("in a loop: " + names);

Switching.target = Switching;
let warm = 0;
for (let i = 0; i < 2000; i++) warm += copy(source).length;
console.log("2000 copies: " + warm);
Switching.target = Tagged;
console.log("then another species: " + describe(copy(source)));

class Odd extends Array<number> {}

function attempt(label: string, body: () => string): void {
  try {
    console.log(label + ": " + body());
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

const odd = new Odd();
odd.push(3, 4);
attempt("no species of its own", () => describe(copy(odd)));
Object.defineProperty(Odd, Symbol.species, { value: undefined, configurable: true });
attempt("undefined", () => describe(copy(odd)));
Object.defineProperty(Odd, Symbol.species, { value: null, configurable: true });
attempt("null", () => describe(copy(odd)));
Object.defineProperty(Odd, Symbol.species, { value: 5, configurable: true });
attempt("a number", () => describe(copy(odd)));
Object.defineProperty(Odd, Symbol.species, { value: () => [], configurable: true });
attempt("an arrow", () => describe(copy(odd)));
Object.defineProperty(Odd, Symbol.species, {
  value: function (length: number) {
    return { length: 0, made: "by a function with " + length };
  },
  configurable: true,
});
attempt("a function that returns an object", () => {
  const made = copy(odd);
  return Array.isArray(made) + " " + JSON.stringify(made) + " length " + made.length;
});
Object.defineProperty(Odd, Symbol.species, { value: Object, configurable: true });
attempt("Object", () => {
  const made = copy(odd);
  return Array.isArray(made) + " " + typeof made + " " + JSON.stringify(made) + " length " + made.length;
});
Reflect.deleteProperty(Odd, Symbol.species);
attempt("restored", () => describe(copy(odd)));

odd.constructor = Tagged;
attempt("the constructor member of the instance is stored to", () => describe(copy(odd)));
Reflect.deleteProperty(odd, "constructor");
attempt("and removed", () => describe(copy(odd)));

export {};
