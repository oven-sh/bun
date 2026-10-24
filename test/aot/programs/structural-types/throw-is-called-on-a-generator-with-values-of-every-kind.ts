function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

function* patient(): Generator<number, string, number> {
  let total = 0;
  let caught = 0;
  for (let i = 0; i < 12; i++) {
    try {
      const sent: number = yield total;
      total += sent;
    } catch (error) {
      caught++;
      console.log("caught " + caught + ": " + (error instanceof Error ? error.constructor.name : text(error)) + ", total is still " + text(total));
    }
  }
  return "total " + total + " caught " + caught;
}

const thrown: unknown[] = [new TypeError("t"), "a string", 7, -0, undefined, null, { code: 5 }, [1, 2], true];

const g = patient();
console.log(text(g.next()));
console.log(text(g.next(5)));
for (const value of thrown) console.log("throw gives " + text(g.throw(value)));
console.log(text(g.next(6)));
console.log(text(g.next(7)));
console.log(text(g.next(8)));

function* careless(): Generator<number, string, number> {
  const sent: number = yield 1;
  console.log("careless: never printed " + sent);
  return "end";
}

for (const value of thrown) {
  const c = careless();
  c.next();
  try {
    console.log("careless gives " + text(c.throw(value)));
  } catch (error) {
    console.log("careless " + failure(error) + ", same value " + Object.is(error, value));
  }
  console.log("careless afterwards " + text(c.next(1)));
}

function* rethrows(): Generator<number, string, number> {
  try {
    yield 1;
  } catch (error) {
    throw new RangeError("wrapped", { cause: error });
  } finally {
    console.log("rethrows: finally");
  }
  return "end";
}

const r = rethrows();
r.next();
try {
  r.throw("reason");
} catch (error) {
  console.log("rethrows " + failure(error) + " cause " + (error instanceof Error ? text(error.cause) : "none"));
}

function* turnsIntoAReturn(): Generator<number, string, number> {
  try {
    yield 1;
  } catch {
    return "caught and returned";
  }
  return "end";
}

const t = turnsIntoAReturn();
t.next();
const last = t.throw(new Error("e"));
console.log("turned into a return: " + text(last) + " " + (last.done ? last.value.length : -1));
