function show(title: string, run: () => unknown): void {
  let result: string;
  try {
    const value = run();
    result = typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
  } catch (error) {
    result = error instanceof TypeError ? "threw a TypeError" : error instanceof ReferenceError ? "threw a ReferenceError" : "threw something else";
  }
  console.log(title + ": " + result);
}

class Feed {
  items: number[] = [1, 2, 3];
  name: string = "feed";
  async first(): Promise<number> {
    return this.items[0];
  }
  async afterAwait(): Promise<string> {
    await null;
    return this.name;
  }
  *each(): Generator<number> {
    for (const item of this.items) yield item;
  }
  *lazyName(): Generator<string> {
    yield "started";
    yield this.name;
  }
  async *stream(): AsyncGenerator<number> {
    yield this.items.length;
  }
  [Symbol.iterator](): Iterator<number> {
    return this.items[Symbol.iterator]();
  }
}

const feed = new Feed();
const { first, afterAwait, each, lazyName, stream } = feed;
const iterate = feed[Symbol.iterator];

async function settle(title: string, run: () => Promise<unknown>): Promise<void> {
  let result: string;
  try {
    const value = await run();
    result = typeof value + " " + String(value);
  } catch (error) {
    result = error instanceof TypeError ? "rejected with a TypeError" : "rejected with something else";
  }
  console.log(title + ": " + result);
}

show("calling the bare async method does not throw", () => {
  const promise = first();
  promise.catch(() => {});
  return typeof promise;
});
show("calling the bare generator method does not throw", () => typeof each());
show("its first step does", () => each().next().value);
show("spread of it", () => [...each()].join());
show("lazyName: first step", () => lazyName().next().value);
show("lazyName: second step", () => {
  const it = lazyName();
  it.next();
  return it.next().value;
});
show("the bare iterator method", () => iterate());
show("honest spread", () => [...feed].join());
show("honest each", () => [...feed.each()].join());
show("each on a look-alike", () => [...feed.each.call({ items: [7, 8] })].join());
show("each on a string for items", () => [...feed.each.call({ items: "ab" })].join());
show("each on a number for items", () => [...feed.each.call({ items: 5 })].join());
show("iterator on a look-alike", () => feed[Symbol.iterator].call({ items: [9] }).next().value);

async function main(): Promise<void> {
  await settle("bare first", () => first());
  await settle("bare afterAwait", () => afterAwait());
  await settle("honest first", () => feed.first());
  await settle("honest afterAwait", () => feed.afterAwait());
  await settle("first on a look-alike", () => feed.first.call({ items: [70] }));
  await settle("first on empty items", () => feed.first.call({ items: [] }));
  await settle("afterAwait on a look-alike", () => feed.afterAwait.call({ name: 5 }));
  await settle("bare stream", () => stream().next());
  await settle("honest stream", async () => (await feed.stream().next()).value);
  await settle("then with the bare method", () => Promise.resolve(0).then(first));
  await settle("then with the bare method that awaits", () => Promise.resolve(0).then(afterAwait));
}
main();
