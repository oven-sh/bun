function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

class Keeper {
  last: string = "none";
  all: string[] = [];
}

const keeper = new Keeper();

function* asks(): Generator<number, string, string> {
  let joined = "";
  for (let i = 1; i <= 3; i++) {
    const answer: string = yield i;
    console.log("answer " + i + ": " + text(answer));
    console.log("answer " + i + " is undefined: " + (answer === undefined));
    console.log("answer " + i + " in a template: " + `<${answer}>`);
    console.log("answer " + i + " added: " + (answer + "!"));
    keeper.last = answer;
    keeper.all.push(answer);
    joined += answer;
    try {
      console.log("answer " + i + " length: " + answer.length);
    } catch (error) {
      console.log("answer " + i + " length: " + failure(error));
    }
  }
  return joined;
}

function drive(numbers: Iterable<number>): number {
  let sum = 0;
  for (const n of numbers) {
    console.log("for-of got " + n);
    sum += n;
  }
  return sum;
}

function state(): string {
  return text(keeper.last) + " | " + keeper.all.map(text).join(", ") + " | " + JSON.stringify(keeper);
}

const honest = asks();
console.log("honest start: " + text(honest.next()));
console.log("honest one: " + text(honest.next("one")));
console.log("honest two: " + text(honest.next("two")));
console.log("honest three: " + text(honest.next("three")));
console.log("keeper after the honest run: " + state());

console.log("an array: " + drive([4, 5]));
console.log("the generator: " + drive(asks()));
console.log("keeper after for-of: " + state());
console.log("a set: " + drive(new Set([6])));

const again = asks();
console.log("again start: " + text(again.next()));
console.log("again one: " + text(again.next("uno")));
console.log("the rest goes to for-of: " + drive(again));
console.log("keeper at the end: " + state());
