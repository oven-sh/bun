class Top {
  id = 1;
  who(): string {
    return "top " + this.id;
  }
  get rank(): number {
    return 1;
  }
  static make(): string {
    return "top make";
  }
}

class Middle extends Top {}

class Lower extends Middle {}

class Leaf extends Lower {}

function whoOf(t: Top): string {
  return t.who() + " " + t.rank;
}

function leafWho(l: Leaf): string {
  return l.who() + " " + l.rank;
}

function lowerWho(l: Lower): string {
  return l.who() + " " + l.rank;
}

const leaf = new Leaf();
const lower = new Lower();
const middle = new Middle();
const top = new Top();

function round(label: string): void {
  console.log(label + ": leaf " + leaf.who() + " " + leafWho(leaf) + " " + whoOf(leaf) + " | lower " + lowerWho(lower) + " " + lowerWho(leaf) + " | middle " + whoOf(middle) + " | top " + whoOf(top) + " | static " + [Leaf.make(), Lower.make(), Middle.make(), Top.make()].join());
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += leafWho(leaf).length + lowerWho(lower).length + whoOf(middle).length + whoOf(top).length + Leaf.make().length;
console.log("2000 honest: " + warm);
round("before");

Lower.prototype.who = function () {
  return "lower " + this.id;
};
round("the lower class gets a method of its own");

Middle.prototype.who = function () {
  return "middle " + this.id;
};
round("the middle class too");

Reflect.deleteProperty(Lower.prototype, "who");
round("the lower class loses its own");

Reflect.deleteProperty(Middle.prototype, "who");
round("the middle class too");

Object.defineProperty(Lower.prototype, "rank", { get: () => 3, configurable: true });
round("the lower class gets a getter of its own");

Object.defineProperty(Leaf.prototype, "rank", { value: 4, configurable: true });
round("the leaf class gets a plain value");

Reflect.deleteProperty(Lower.prototype, "rank");
Reflect.deleteProperty(Leaf.prototype, "rank");
round("both removed");

Lower.make = () => "lower make";
round("the lower class gets a static method of its own");

Reflect.deleteProperty(Lower, "make");
round("removed");

export {};
