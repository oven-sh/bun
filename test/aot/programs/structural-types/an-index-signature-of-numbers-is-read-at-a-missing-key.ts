function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Prices {
  [item: string]: number;
}

function priceOf(prices: Prices, item: string): number {
  return prices[item];
}

function withTax(prices: Prices, item: string): number {
  return prices[item] * 1.5;
}

function totalOf(prices: Prices, items: string[]): number {
  let sum = 0;
  for (const item of items) sum += prices[item];
  return sum;
}

const prices: Prices = { tea: 2, cake: 3.5 };

show("a key that is there", () => [prices.tea, priceOf(prices, "cake"), withTax(prices, "tea")]);
show("a missing key by a dot", () => [prices.milk, typeof prices.milk]);
show("a missing key by a literal", () => prices["milk"]);
show("a missing key by a variable", () => priceOf(prices, "milk"));
show("plus one", () => prices.milk + 1);
show("times", () => withTax(prices, "milk"));
show("to a whole number", () => priceOf(prices, "milk") | 0);
show("toFixed", () => prices.milk.toFixed(2));
show("compared", () => [prices.milk > 0, prices.milk === 0, prices.milk === undefined]);
show("or zero", () => prices.milk ?? 0);
show("a typed local", () => {
  const price: number = prices.milk;
  return price;
});
show("a typed list", () => {
  const list: number[] = ["tea", "milk", "cake"].map(item => prices[item]);
  return list;
});
show("added up", () => [totalOf(prices, ["tea", "cake"]), totalOf(prices, ["tea", "milk", "cake"])]);
show("as doubles", () => Array.from(Float64Array.from(["tea", "milk"], item => prices[item])));
show("taken apart", () => {
  const { tea, milk } = prices;
  return [tea, milk];
});
show("in", () => ["tea" in prices, "milk" in prices]);
show("keys", () => Object.keys(prices));

let sum = 0;
for (let i = 0; i < 2000; i++) sum += priceOf(prices, i % 2 === 0 ? "tea" : "cake");
show("2000 reads of keys that are there", () => sum);
show("then a missing one", () => [priceOf(prices, "milk"), withTax(prices, "milk")]);

prices.milk++;
show("++ at a missing key", () => [prices.milk, Object.keys(prices)]);
prices.water += 1;
show("+= at a missing key", () => [prices.water, JSON.stringify(prices)]);
delete prices.tea;
show("after a key is deleted", () => [prices.tea, priceOf(prices, "tea"), Object.keys(prices)]);
