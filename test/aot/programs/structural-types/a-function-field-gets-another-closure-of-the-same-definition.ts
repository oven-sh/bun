function adder(amount: number): (n: number) => number {
  return n => n + amount;
}

function labeled(label: string, amount: number): (n: number) => string {
  let calls = 0;
  return n => label + " " + (n + amount) + " call " + ++calls;
}

class Machine {
  step: (n: number) => number;
  say: (n: number) => string;
  constructor(amount: number) {
    this.step = adder(amount);
    this.say = labeled("made with " + amount, amount);
  }
  run(n: number): number {
    return this.step(this.step(n));
  }
}

class Holder {
  machine: Machine;
  constructor(machine: Machine) {
    this.machine = machine;
  }
  ask(n: number): number {
    return this.machine.step(n);
  }
}

function byParameter(m: Machine, n: number): number {
  return m.step(n);
}

function byElement(list: Machine[], n: number): number {
  return list[0].step(n);
}

const changed = new Machine(1);
const honest = new Machine(1);
const holder = new Holder(changed);
const list = [changed];
const captured = (n: number): number => changed.step(n);

function everywhere(label: string): void {
  const local = changed;
  console.log(label + ": " + [changed.step(0), local.step(0), byParameter(changed, 0), holder.ask(0), byElement(list, 0), captured(0), changed.run(0)].join(" ") + " | honest " + [honest.step(0), byParameter(honest, 0), honest.run(0)].join(" "));
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += changed.step(i) + byParameter(changed, i) + holder.ask(i) + byElement(list, i) + captured(i) + changed.run(i) + byParameter(honest, i);
console.log("2000 honest: " + warm);
everywhere("made with 1");

const first = changed.step;
changed.step = adder(10);
everywhere("the same definition with 10");
changed.step = adder(0.5);
everywhere("with a fraction");
changed.step = adder(-0);
everywhere("with minus zero");
changed.step = adder(NaN);
everywhere("with not a number");
changed.step = adder(2 ** 31);
everywhere("with a large number");
changed.step = first;
everywhere("the first one again");
changed.step = honest.step;
everywhere("the closure of the other machine");
console.log("shared: " + (changed.step === honest.step) + ", the first is another: " + (first === honest.step));

console.log("say: " + changed.say(1) + " | " + changed.say(1) + " | " + honest.say(1));
const firstSay = changed.say;
changed.say = labeled("replaced", 100);
console.log("say replaced: " + changed.say(1) + " | " + changed.say(1) + " | " + honest.say(1));
changed.say = firstSay;
console.log("say put back, its count goes on: " + changed.say(1));

const many: Machine[] = [];
for (let i = 0; i < 2000; i++) many.push(new Machine(i % 3));
many[1234].step = adder(1000000);
let total = 0;
for (const each of many) total += each.step(0);
console.log("2000 machines and one of them changed: " + total);

export {};
