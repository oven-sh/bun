const log: string[] = [];

class Adder {
  base = 100;
  fn: (n: number) => string = n => "first field " + n;
  add(n: number): string {
    return "first method " + (this.base + n);
  }
  static make(n: number): string {
    return "first static " + n;
  }
  get swapOwn(): number {
    log.push("swapOwn");
    this.add = n => "own " + n;
    return 1;
  }
  get swapPrototype(): number {
    log.push("swapPrototype");
    Adder.prototype.add = function (n) {
      return "second method " + (this.base + n);
    };
    return 2;
  }
  get swapField(): number {
    log.push("swapField");
    this.fn = n => "second field " + n;
    return 3;
  }
  get swapStatic(): number {
    log.push("swapStatic");
    Adder.make = n => "second static " + n;
    return 4;
  }
}

const originalAdd = Adder.prototype.add;
const originalMake = Adder.make;

function line(label: string, value: string): void {
  console.log(label + ": " + value + " [" + log.join() + "]");
  log.length = 0;
}

function callOwn(a: Adder): string {
  return a.add(a.swapOwn);
}

function callPrototype(a: Adder): string {
  return a.add(a.swapPrototype);
}

function callField(a: Adder): string {
  return a.fn(a.swapField);
}

function callStatic(a: Adder): string {
  return Adder.make(a.swapStatic);
}

const one = new Adder();
line("an own member appears while the argument runs", callOwn(one));
line("the next call", callOwn(one));
line("plainly", one.add(0));

const two = new Adder();
line("the prototype changes while the argument runs", callPrototype(two));
line("the next call", callPrototype(two));
Adder.prototype.add = originalAdd;
line("put back", two.add(0));

const three = new Adder();
line("the field changes while the argument runs", callField(three));
line("the next call", callField(three));

line("the static method changes while the argument runs", callStatic(three));
line("the next call", callStatic(three));
Adder.make = originalMake;
line("put back", Adder.make(0));

function swapReceiver(holder: { a: Adder }, next: Adder): number {
  holder.a = next;
  return 5;
}

const louder = new Adder();
louder.base = 1000;
const holder = { a: new Adder() };
line("the receiver's holder changes while the argument runs", holder.a.add(swapReceiver(holder, louder)));
line("the next call", holder.a.add(0));

let warm = 0;
const honest = new Adder();
for (let i = 0; i < 2000; i++) warm += honest.add(i).length + honest.fn(i).length + Adder.make(i).length;
console.log("2000 honest: " + warm);
line("then an own member", callOwn(honest));
line("then the field", callField(honest));
line("and again", callOwn(honest) + " | " + callField(honest));

export {};
