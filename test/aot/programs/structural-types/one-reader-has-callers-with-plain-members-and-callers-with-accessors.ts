interface Item {
  price: number;
  count: number;
}

const log: string[] = [];

function cost(item: Item): number {
  return item.price * item.count;
}

function restock(item: Item, by: number): number {
  item.count += by;
  return item.count;
}

function flush(label: string, value: unknown): void {
  console.log(label + ": " + String(value) + " [" + log.join(", ") + "]");
  log.length = 0;
}

function plainCallerOne(): number {
  return cost({ price: 2, count: 3 });
}

function plainCallerTwo(): number {
  const item: Item = { price: 4, count: 5 };
  restock(item, 1);
  return cost(item);
}

function plainMany(): number {
  const item: Item = { price: 1, count: 0 };
  let total = 0;
  for (let i = 0; i < 2000; i++) total += cost(item) + restock(item, 1);
  return total;
}

function watched(): Item {
  let count = 7;
  return {
    get price() {
      log.push("get price");
      return 6;
    },
    get count() {
      log.push("get count");
      return count;
    },
    set count(value: number) {
      log.push("set count " + value);
      count = value;
    },
  };
}

class Stock {
  #count = 9;
  get price(): number {
    log.push("Stock price");
    return 8;
  }
  get count(): number {
    log.push("Stock get count");
    return this.#count;
  }
  set count(value: number) {
    log.push("Stock set count " + value);
    this.#count = value;
  }
}

function accessorCaller(): number {
  return cost(watched());
}

function classCaller(): number {
  const stock = new Stock();
  restock(stock, 1);
  return cost(stock);
}

function inheritedCaller(): number {
  const item: Item = Object.create(watched());
  restock(item, 1);
  return cost(item);
}

const tools = { cost, restock };
const which: keyof typeof tools = "cost";

flush("accessors first of all", accessorCaller());
flush("plain, one", plainCallerOne());
flush("plain, two", plainCallerTwo());
flush("plain, 2000 times", plainMany());
flush("own accessors", accessorCaller());
flush("accessors of a class", classCaller());
flush("accessors on the prototype", inheritedCaller());
flush("plain again", plainCallerOne());
flush("call", cost.call(undefined, watched()));
flush("apply", cost.apply(undefined, [new Stock()]));
flush("bind", restock.bind(undefined, watched(), 2)());
flush("Reflect.apply", Reflect.apply(restock, undefined, [new Stock(), 3]));
flush("by a computed name", tools[which](watched()));
flush("a built-in calls it", [{ price: 1, count: 1 }, watched(), new Stock()].map(cost).join());
flush("a comparator", [watched(), { price: 1, count: 1 }].toSorted((a, b) => cost(a) - cost(b)).length);
flush("a reducer", [watched(), new Stock()].reduce((sum, item) => sum + cost(item), 0));
flush("a promise reaction", await Promise.resolve(watched()).then(cost));
flush("plain at the end", plainCallerTwo());

export {};
