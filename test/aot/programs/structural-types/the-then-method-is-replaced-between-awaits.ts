const log: string[] = [];

class Later implements PromiseLike<number> {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
  then<A = number, B = never>(resolve?: ((value: number) => A | PromiseLike<A>) | null, reject?: ((reason: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    log.push("class then");
    return Promise.resolve(this.value).then(resolve, reject);
  }
}

async function wait(l: Later): Promise<number> {
  return await l;
}

async function waitTwice(l: Later, between: () => void): Promise<string> {
  const a = await l;
  between();
  const b = await l;
  return a + " " + b;
}

function line(label: string, value: unknown): void {
  console.log(label + ": " + String(value) + " [" + log.join(", ") + "]");
  log.length = 0;
}

const l = new Later(1);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += await wait(l);
log.length = 0;
line("2000 honest", warm);
line("the class's then", await wait(l));

const hundred: Later["then"] = (resolve, reject) => {
  log.push("own then");
  return Promise.resolve(100).then(resolve, reject);
};

line(
  "an own then appears between two awaits",
  await waitTwice(l, () => {
    l.then = hundred;
  }),
);
line("it stays", await wait(l));
line("Promise.resolve", await Promise.resolve(l));
line("Promise.all", (await Promise.all([l, new Later(2)])).join());
line("returned from an async function", await (async () => l)());
line("returned from a reaction", await Promise.resolve(0).then(() => l));
Reflect.deleteProperty(l, "then");
line("uncovered", await wait(l));

const original = Later.prototype.then;
Later.prototype.then = hundred;
line("replaced on the prototype", (await wait(l)) + " " + (await wait(new Later(5))));
Later.prototype.then = original;
line("put back", await wait(l));

const real = Promise.resolve(7);
line("a real promise", await real);
real.then = (resolve, reject) => {
  log.push("own then of a real promise");
  return Promise.resolve(700).then(resolve, reject);
};
line("with a then of its own, awaited", await real);
line("Promise.resolve gives it back", Promise.resolve(real) === real);
line("Promise.all", (await Promise.all([real])).join());
line("Promise.race", await Promise.race([real]));
line("returned from an async function", await (async () => real)());
line("returned from a reaction", await Promise.resolve(0).then(() => real));
line("called by name", await real.then(n => n + 1));
Reflect.deleteProperty(real, "then");
line("removed", await real);

export {};
