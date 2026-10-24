class Reading {
  at: number;
  level: number;
  place: string;
  constructor(at: number, level: number, place: string) {
    this.at = at;
    this.level = level;
    this.place = place;
  }
}

function* readings(count: number): Generator<Reading, number, number> {
  let scale = 1;
  let total = 0;
  for (let i = 0; i < count; i++) {
    const reading = new Reading(i, i * scale, i % 2 === 0 ? "north" : "south");
    total += reading.level;
    const sent: number = yield reading;
    scale = sent;
  }
  return total;
}

function drive(count: number): number {
  const generator = readings(count);
  let result = generator.next(1);
  let sum = 0;
  while (!result.done) {
    sum += result.value.level + result.value.place.length;
    result = generator.next(2);
  }
  return sum + result.value;
}

function* range(from: number, to: number): Generator<number, void, void> {
  for (let i = from; i < to; i++) yield i;
}

function* twice(inner: Generator<number, void, void>): Generator<number, string, void> {
  let count = 0;
  for (const n of inner) {
    count++;
    yield n * 2;
  }
  return "doubled " + count;
}

function* joined(): Generator<number, string, void> {
  const first: string = yield* twice(range(0, 3));
  const second: string = yield* twice(range(10, 12));
  return first + " and " + second;
}

async function level(reading: Reading): Promise<number> {
  return reading.level;
}

async function sumLevels(list: Reading[]): Promise<number> {
  let sum = 0;
  for (const reading of list) sum += await level(reading);
  return sum;
}

async function* stream(count: number): AsyncGenerator<Reading, string, void> {
  for (let i = 0; i < count; i++) {
    await null;
    yield new Reading(i, i * 3, "east");
  }
  return "streamed " + count;
}

async function drain(count: number): Promise<number> {
  let sum = 0;
  for await (const reading of stream(count)) sum += reading.level + reading.at;
  return sum;
}

console.log("drive 5: " + drive(5));
let warm = 0;
for (let i = 0; i < 2000; i++) warm += drive(3);
console.log("drive 3, 2000 times: " + warm);

let looped = 0;
for (const n of range(0, 2000)) looped += n;
console.log("range: " + looped);
console.log("spread: " + [...twice(range(1, 4))].join());

const j = joined();
const seen: number[] = [];
let step = j.next();
while (!step.done) {
  seen.push(step.value);
  step = j.next();
}
console.log("joined: " + seen.join() + " | " + step.value + " | " + step.value.length);

const list: Reading[] = [];
for (let i = 0; i < 2000; i++) list.push(new Reading(i, i & 7, "west"));
console.log("sumLevels: " + (await sumLevels(list)));
console.log("drain: " + (await drain(100)));

const [a, b, c] = await Promise.all([level(list[3]), Promise.resolve("text"), sumLevels(list.slice(0, 4))]);
console.log("all: " + (a + c) + " " + b.length);

const chained = await Promise.resolve(2)
  .then(n => n * 3)
  .then(n => new Reading(n, n + 1, "chain"))
  .then(reading => reading.place + reading.level);
console.log("chain: " + chained);

const byHand = stream(2);
const first = await byHand.next();
const second = await byHand.next();
const third = await byHand.next();
console.log("by hand: " + (first.done ? first.value : first.value.level) + " " + (second.done ? second.value : second.value.level) + " " + (third.done ? third.value : third.value.level));

export {};
