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
  above(): string {
    return super.move();
  }
}

function moveOf(p: Person): string {
  return p.move() + " at " + p.speed;
}

function asWalker(w: Walker): string {
  return w.move() + " at " + w.speed;
}

function hang(below: object, above: object): void {
  Object.setPrototypeOf(below, above);
}

const p = new Person();

function report(label: string): void {
  console.log(label + ": " + p.move() + " | " + moveOf(p) + " | " + asWalker(p) + " | " + p.above() + " | " + moveOf(new Person()) + " | " + asWalker(new Walker()) + " | " + (p instanceof Walker) + " " + (p instanceof Swimmer));
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += moveOf(p).length + asWalker(p).length + p.above().length + (p instanceof Walker ? 1 : 0);
console.log("2000 honest rounds: " + warm);
report("before");
hang(Person.prototype, Swimmer.prototype);
report("under the swimmer");
hang(Person.prototype, Walker.prototype);
report("back under the walker");
hang(Person.prototype, Swimmer.prototype);
report("under the swimmer again");

export {};
