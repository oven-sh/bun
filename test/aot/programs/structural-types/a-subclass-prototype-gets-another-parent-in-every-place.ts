class Walker {
  legs = 2;
  move(): string {
    return "walks on " + this.legs;
  }
  get speed(): number {
    return this.legs * 3;
  }
}

class Swimmer {
  legs = 0;
  move(): string {
    return "swims with " + this.legs;
  }
  get speed(): number {
    return 50;
  }
}

class Person extends Walker {
  name = "person";
}

class Holder {
  constructor(public person: Person) {}
  ask(): string {
    return this.person.move() + " at " + this.person.speed;
  }
}

function byParameter(p: Person): string {
  return p.move() + " at " + p.speed;
}

function asWalker(w: Walker): string {
  return w.move() + " at " + w.speed;
}

function byElement(list: Person[]): string {
  return list[0].move() + " at " + list[0].speed;
}

const old = new Person();
const holder = new Holder(old);
const list = [old];
const captured = (): string => old.move() + " at " + old.speed;

function everywhere(label: string): void {
  const local = old;
  console.log(label + ", directly: " + old.move() + " at " + old.speed);
  console.log(label + ", a local: " + local.move() + " at " + local.speed);
  console.log(label + ", a parameter: " + byParameter(old));
  console.log(label + ", typed as the parent: " + asWalker(old));
  console.log(label + ", a field: " + holder.ask());
  console.log(label + ", an element: " + byElement(list));
  console.log(label + ", captured: " + captured());
  console.log(label + ", a new person: " + byParameter(new Person()) + ", keys " + Object.keys(new Person()).join());
  console.log(label + ", a real walker: " + asWalker(new Walker()));
  console.log(label + ", instanceof: " + (old instanceof Person) + " " + (old instanceof Walker) + " " + (old instanceof Swimmer));
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += byParameter(old).length + asWalker(old).length + holder.ask().length + byElement(list).length + captured().length;
console.log("2000 honest: " + warm);
everywhere("before");

Object.setPrototypeOf(Person.prototype, Swimmer.prototype);
everywhere("under the swimmer");

Object.setPrototypeOf(Person.prototype, Walker.prototype);
everywhere("back under the walker");

Reflect.setPrototypeOf(Person.prototype, Swimmer.prototype);
console.log("once more, by Reflect: " + byParameter(old) + " | " + asWalker(old));
Reflect.setPrototypeOf(Person.prototype, Walker.prototype);
console.log("and back: " + byParameter(old) + " | " + asWalker(old));

export {};
