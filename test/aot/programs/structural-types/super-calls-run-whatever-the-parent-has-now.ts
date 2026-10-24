class Base {
  name = "instance";
  greet(): string {
    return "base(" + this.name + ")";
  }
}

class Middle extends Base {
  greet(): string {
    return "middle(" + super.greet() + ")";
  }
}

class Leaf extends Middle {
  greet(): string {
    return "leaf(" + super.greet() + ")";
  }
  viaArrow(): string {
    const inner = (): string => super.greet();
    return "arrow(" + inner() + ")";
  }
  viaCallback(): string {
    return [1, 2].map(() => super.greet()).join("+");
  }
}

class Quiet extends Middle {}

function greet(b: Base): string {
  return b.greet();
}

const leaf = new Leaf();
const quiet = new Quiet();

function round(label: string): void {
  console.log(label + ": " + leaf.greet() + " | " + greet(leaf) + " | " + leaf.viaArrow() + " | " + leaf.viaCallback() + " | " + greet(quiet) + " | " + greet(new Middle()) + " | " + greet(new Base()));
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += greet(leaf).length + leaf.viaArrow().length + greet(quiet).length;
console.log("2000 honest: " + warm);
round("before");

const baseGreet = Base.prototype.greet;
const middleGreet = Middle.prototype.greet;

Base.prototype.greet = function () {
  return "BASE(" + this.name + ")";
};
round("the base replaced");

Middle.prototype.greet = function () {
  return "MIDDLE(" + this.name + ")";
};
round("the middle replaced by one without super");

Base.prototype.greet = baseGreet;
round("the base put back");

Middle.prototype.greet = middleGreet;
round("the middle put back");

leaf.greet = () => "own";
round("an own member: super does not see it");
console.log("the leaf's method on that instance: " + Leaf.prototype.greet.call(leaf));
Reflect.deleteProperty(leaf, "greet");

const middleView: { greet?: () => string } = Middle.prototype;
delete middleView.greet;
round("the middle's method deleted");

Middle.prototype.greet = middleGreet;
round("restored");

Base.prototype.greet = Quiet.prototype.toString;
round("the base runs a built-in");
Base.prototype.greet = baseGreet;
round("restored again");

export {};
