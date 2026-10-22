class Clock {
  static ticks = 0;
  static tick(): string {
    Clock.ticks++;
    if (Clock.ticks === 3) Clock.tick = Clock.fast;
    return "slow " + Clock.ticks;
  }
  static fast(): string {
    Clock.ticks += 10;
    if (Clock.ticks > 30) Clock.tick = original;
    return "fast " + Clock.ticks;
  }
  static run(rounds: number): string[] {
    const seen: string[] = [];
    for (let i = 0; i < rounds; i++) seen.push(this.tick());
    return seen;
  }
}

const original = Clock.tick;

function run(rounds: number): string[] {
  const seen: string[] = [];
  for (let i = 0; i < rounds; i++) seen.push(Clock.tick());
  return seen;
}

console.log("by itself, from outside: " + run(8).join(", "));
Clock.ticks = 0;
Clock.tick = original;
console.log("by itself, from a static method: " + Clock.run(8).join(", "));

Clock.ticks = 100;
Clock.tick = original;
const seen: string[] = [];
for (let i = 0; i < 6; i++) {
  seen.push(Clock.tick());
  if (i === 1) Clock.tick = () => "loop " + i;
  if (i === 3) Clock.tick = original;
}
console.log("by the loop's own body: " + seen.join(", "));

const byCallback: string[] = [];
[0, 1, 2, 3].forEach(i => {
  byCallback.push(Clock.tick());
  Clock.tick = i % 2 === 0 ? () => "callback " + i : original;
});
console.log("by a callback of a built-in: " + byCallback.join(", "));
Clock.tick = original;

Clock.ticks = 1000;
let last = "";
for (let i = 0; i < 2004; i++) {
  last = Clock.tick();
  if (i === 2000) Clock.tick = () => "late";
  if (i === 2002) Clock.tick = original;
  if (i >= 2000) console.log("round " + i + ": " + last);
}

export {};
