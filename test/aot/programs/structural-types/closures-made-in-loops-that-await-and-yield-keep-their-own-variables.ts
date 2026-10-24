function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

async function perRound(): Promise<string> {
  const readers: (() => number)[] = [];
  for (let i = 0; i < 3; i++) {
    readers.push(() => i);
    await null;
  }
  return readers.map(read => read()).join();
}

async function changedInTheBody(): Promise<string> {
  const readers: (() => number)[] = [];
  for (let i = 0; i < 6; i++) {
    readers.push(() => i);
    await null;
    i++;
  }
  return readers.map(read => read()).join();
}

async function sharedByVar(): Promise<string> {
  const readers: (() => number)[] = [];
  for (var i = 0; i < 3; i++) {
    readers.push(() => i);
    await null;
  }
  return readers.map(read => read()).join();
}

async function writers(): Promise<string> {
  const bumps: (() => number)[] = [];
  for (let i = 0; i < 3; i++) {
    bumps.push(() => ++i);
    await null;
  }
  return bumps.map(bump => bump() + ":" + bump()).join();
}

async function closureMovesTheLoop(): Promise<string> {
  const seen: number[] = [];
  for (let i = 0; i < 10; i++) {
    const skip = (): void => {
      i += 3;
    };
    seen.push(i);
    await null;
    skip();
  }
  return seen.join();
}

function* yielding(): Generator<() => number, void, void> {
  for (let i = 0; i < 3; i++) yield () => i * 10;
}

function* yieldingWriters(): Generator<() => number, number, void> {
  let total = 0;
  for (let i = 0; i < 3; i++) {
    yield () => (total += i);
  }
  return total;
}

async function overItems(): Promise<string> {
  const readers: (() => string)[] = [];
  for (const word of ["a", "b", "c"]) {
    await null;
    readers.push(() => word);
  }
  for await (const word of ["d", Promise.resolve("e")]) readers.push(() => word);
  for (const key in { x: 1, y: 2 }) {
    await null;
    readers.push(() => key);
  }
  return readers.map(read => read()).join();
}

async function inner(): Promise<string> {
  const out: string[] = [];
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const read = (): string => i + "" + j;
      await null;
      out.push(read());
    }
  }
  return out.join();
}

async function caught(): Promise<string> {
  const readers: (() => unknown)[] = [];
  for (const value of [1, "two"]) {
    try {
      await Promise.reject(value);
    } catch (error) {
      readers.push(() => error);
    }
  }
  return readers.map(read => text(read())).join();
}

console.log("one variable a round: " + (await perRound()));
console.log("changed in the body after the closure: " + (await changedInTheBody()));
console.log("var is shared: " + (await sharedByVar()));
console.log("closures that write: " + (await writers()));
console.log("a closure moves the loop: " + (await closureMovesTheLoop()));
console.log("yielded closures, called later: " + [...yielding()].map(read => read()).join());

const w = yieldingWriters();
const first = w.next();
const second = w.next();
const third = w.next();
const calls: number[] = [];
for (const step of [third, first, second, third]) if (!step.done) calls.push(step.value());
console.log("yielded writers: " + calls.join() + " then " + text(w.next()));

console.log("for-of, for await and for-in: " + (await overItems()));
console.log("nested: " + (await inner()));
console.log("catch variables: " + (await caught()));

export {};
