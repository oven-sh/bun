const names = ["a", "asked", "f", "h", "late", "none"];
const nameAt = (index: number): string => names[index % names.length];

function ask(object: object): string {
  const answers: unknown[] = [];
  for (let i = 0; i < names.length; ++i) {
    const name = nameAt(i);
    answers.push(
      name,
      Object.hasOwn(object, name),
      Object.prototype.hasOwnProperty.call(object, name),
      name in object,
      Reflect.has(object, name),
      Object.prototype.propertyIsEnumerable.call(object, name),
      Object.getOwnPropertyDescriptor(object, name) !== undefined,
    );
  }
  return answers.map(answer => (answer === true ? "+" : answer === false ? "-" : " " + answer + " ")).join("");
}

class Laid {
  a = 1;
  asked: string = [
    Object.hasOwn(this, "a"),
    Object.hasOwn(this, "asked"),
    Object.hasOwn(this, "f"),
    Object.hasOwn(this, "h"),
    Object.hasOwn(this, "late"),
    Object.hasOwn(this, "none"),
    this.hasOwnProperty("a"),
    this.hasOwnProperty("h"),
    Object.prototype.hasOwnProperty.call(this, "h"),
    "h" in this,
    Reflect.has(this, "h"),
    this.propertyIsEnumerable("h"),
    Object.getOwnPropertyDescriptor(this, "h") === undefined,
    Object.keys(this).join(),
    Object.getOwnPropertyNames(this).join(),
    Reflect.ownKeys(this).join(),
    Object.entries(this).length,
    JSON.stringify(this),
    Object.keys({ ...this }).join(),
  ].join(" ");
  byKey: string = ask(this);
  f = (): number => this.a;
  again: string = [Object.hasOwn(this, "f"), Object.hasOwn(this, "h"), Object.hasOwn(this, "again"), this.hasOwnProperty("h"), ask(this)].join(" ");
  h = 3;
  late?: number;
  behind: string = [Object.hasOwn(this, "h"), Object.hasOwn(this, "late"), Object.hasOwn(this, "behind"), ask(this)].join(" ");
}

class Heir extends Laid {
  own = 5;
  heirAsked: string = [Object.hasOwn(this, "h"), Object.hasOwn(this, "own"), Object.hasOwn(this, "heirAsked"), Object.hasOwn(this, "last"), this.hasOwnProperty("last"), ask(this)].join(" ");
  last = 6;
}

class Quiet {
  a = 1;
  h = 3;
  late?: number;
}

function whole(object: Laid | Quiet): string {
  return [Object.hasOwn(object, "a"), Object.hasOwn(object, "h"), Object.hasOwn(object, "late"), Object.hasOwn(object, "none"), object.hasOwnProperty("h"), object.hasOwnProperty("late")].join();
}

for (let round = 0; round < 3; ++round) {
  const laid = new Laid();
  console.log(laid.asked);
  console.log(laid.byKey);
  console.log(laid.again);
  console.log(laid.behind);
  console.log(whole(laid), ask(laid));
  const heir = new Heir();
  console.log(heir.asked === laid.asked, heir.again === laid.again, heir.heirAsked);
  console.log(whole(heir), Object.hasOwn(heir, "last"), Object.hasOwn(heir, "own"));
  const quiet = new Quiet();
  console.log(whole(quiet), ask(quiet));
  quiet.late = 1;
  laid.late = 2;
  console.log(whole(quiet), whole(laid));
  delete quiet.late;
  console.log(whole(quiet));
}
