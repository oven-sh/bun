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

export {};
