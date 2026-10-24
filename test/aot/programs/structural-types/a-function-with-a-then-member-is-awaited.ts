function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

type Maker = () => number;

function plainMaker(): number {
  return 1;
}

function thenableMaker(): number {
  return 2;
}
thenableMaker.then = (resolve: (value: string) => void): void => {
  console.log("  the then of the function runs");
  resolve("not a function at all");
};

const assigned = Object.assign((): number => 3, {
  then(resolve: (value: number) => void): void {
    console.log("  the then of the assigned one runs");
    resolve(33);
  },
});

class Factory {
  static then(resolve: (value: string) => void): void {
    console.log("  the static then runs");
    resolve("the class resolved");
  }
  made = true;
}

class Quiet {
  made = true;
}

async function callLater(make: Maker): Promise<string> {
  const ready: Maker = await make;
  try {
    return "typeof " + typeof ready + ", called " + text(ready());
  } catch (error) {
    return "typeof " + typeof ready + ", threw " + (error instanceof Error ? error.constructor.name : typeof error);
  }
}

async function passOn(make: Maker): Promise<Maker> {
  return make;
}

async function construct(type: new () => Factory): Promise<string> {
  const ready = await type;
  try {
    return "typeof " + typeof ready + ", made " + text(new ready());
  } catch (error) {
    return "typeof " + typeof ready + ", threw " + (error instanceof Error ? error.constructor.name : typeof error);
  }
}

console.log("plain: " + (await callLater(plainMaker)));
console.log("an arrow: " + (await callLater(() => 9)));
console.log("with a then member: " + (await callLater(thenableMaker)));
console.log("assigned: " + (await callLater(assigned)));
console.log("plain again: " + (await callLater(plainMaker)));

console.log("passed on, plain: " + text(await passOn(plainMaker)));
console.log("passed on, with a then member: " + text(await passOn(thenableMaker)));
console.log("passed on, assigned: " + text(await passOn(assigned)));

console.log("a class with a static then: " + (await construct(Factory)));
console.log("a class without: " + (await construct(Quiet)));

const list: Maker[] = [plainMaker, thenableMaker, assigned];
const all: Maker[] = await Promise.all(list);
console.log("Promise.all: " + all.map(text).join(" | "));

export {};
