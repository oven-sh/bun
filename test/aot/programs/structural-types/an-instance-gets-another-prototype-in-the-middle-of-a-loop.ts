class Slow {
  distance = 0;
  step(): number {
    return (this.distance += 1);
  }
}

class Fast {
  distance = 0;
  step(): number {
    return (this.distance += 100);
  }
}

class Child extends Slow {}

function run(s: Slow, rounds: number, at: number, back: number): string {
  const seen: number[] = [];
  for (let i = 0; i < rounds; i++) {
    if (i === at) Object.setPrototypeOf(s, Fast.prototype);
    if (i === back) Object.setPrototypeOf(s, Slow.prototype);
    seen.push(s.step());
  }
  return seen.slice(-8).join(" ");
}

console.log("early: " + run(new Slow(), 8, 2, 5));
console.log("late: " + run(new Slow(), 2006, 2000, 2003));
console.log("a subclass instance: " + run(new Child(), 8, 2, 5));

function runShared(list: Child[], rounds: number): string {
  const seen: number[] = [];
  for (let i = 0; i < rounds; i++) {
    if (i === 2) Object.setPrototypeOf(Child.prototype, Fast.prototype);
    if (i === 4) Object.setPrototypeOf(Child.prototype, Slow.prototype);
    for (const each of list) seen.push(each.step());
  }
  return seen.join(" ");
}

console.log("the class's prototype, two instances: " + runShared([new Child(), new Child()], 6));

class Turning {
  turns = 0;
  turn(): string {
    this.turns++;
    if (this.turns === 2) Object.setPrototypeOf(this, Turned.prototype);
    return "turning " + this.turns;
  }
}

class Turned {
  turns = 0;
  turn(): string {
    this.turns++;
    if (this.turns === 4) Object.setPrototypeOf(this, Turning.prototype);
    return "turned " + this.turns;
  }
}

function spin(t: Turning, rounds: number): string {
  const seen: string[] = [];
  for (let i = 0; i < rounds; i++) seen.push(t.turn() + " " + (t instanceof Turning));
  return seen.join(", ");
}

console.log("the method re-parents its own receiver: " + spin(new Turning(), 6));

const mixed: Slow[] = [];
for (let i = 0; i < 2000; i++) mixed.push(new Slow());
Object.setPrototypeOf(mixed[1500], Fast.prototype);
let total = 0;
for (const each of mixed) total += each.step();
console.log("one of 2000 elements: " + total);

export {};
