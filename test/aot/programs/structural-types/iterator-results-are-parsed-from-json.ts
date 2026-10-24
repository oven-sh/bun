function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

class Replay implements Iterable<number> {
  texts: string[];
  returned = 0;
  constructor(texts: string[]) {
    this.texts = texts;
  }
  [Symbol.iterator](): Iterator<number> {
    let at = 0;
    return {
      next: (): IteratorResult<number> => JSON.parse(at < this.texts.length ? this.texts[at++] : '{"done":true}'),
      return: (): IteratorResult<number> => {
        this.returned++;
        return { done: true, value: undefined };
      },
    };
  }
}

function* delegating(numbers: Iterable<number>): Generator<number, void, void> {
  yield* numbers;
}

const scripts: [string, string[]][] = [
  ["honest", ['{"value":1,"done":false}', '{"value":2,"done":false}']],
  ["done is zero", ['{"value":1,"done":0}', '{"value":2,"done":0}']],
  ["done is an empty text", ['{"value":1,"done":""}']],
  ["done is null", ['{"value":1,"done":null}']],
  ["done is one", ['{"value":1,"done":false}', '{"value":2,"done":1}', '{"value":3,"done":false}']],
  ["done is a text", ['{"value":1,"done":"no"}', '{"value":2,"done":false}']],
  ["done is an object", ['{"value":1,"done":{}}']],
  ["no members at all", ["{}", "{}"]],
  ["an array", ["[]", "[5]"]],
  ["the value is a text", ['{"value":"one","done":false}', '{"value":2,"done":false}']],
  ["the value is null", ['{"value":null,"done":false}']],
  ["a number", ["1"]],
  ["null", ["null"]],
  ["a text", ['"text"']],
  ["true", ["true"]],
  ["a number after an honest one", ['{"value":1,"done":false}', "2"]],
];

const uses: [string, (numbers: Iterable<number>) => unknown][] = [
  ["for-of", numbers => {
    let sum = 0;
    const kinds: string[] = [];
    for (const n of numbers) {
      kinds.push(typeof n);
      sum += n;
    }
    return kinds.join() + " sum " + text(sum);
  }],
  ["spread", numbers => [...numbers].map(text)],
  ["destructuring", numbers => {
    const [a, b] = numbers;
    return text(a) + " and " + text(b);
  }],
  ["yield*", numbers => [...delegating(numbers)].map(text)],
  ["Array.from", numbers => Array.from(numbers, n => text(n * 2))],
];

for (const [name, script] of scripts) {
  for (const [label, use] of uses) {
    const replay = new Replay(script);
    try {
      console.log(name + ", " + label + ": " + text(use(replay)) + ", returned " + replay.returned);
    } catch (error) {
      console.log(name + ", " + label + ": " + failure(error) + ", returned " + replay.returned);
    }
  }
}
