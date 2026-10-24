function say(name: string, f: () => unknown) {
  let text: string;
  try {
    text = JSON.stringify(f(), (_, value) => (value === undefined ? "<undefined>" : typeof value === "number" && !Number.isFinite(value) ? String(value) : Object.is(value, -0) ? "-0" : value)) ?? "undefined";
  } catch (error) {
    text = "throws " + (error as Error).constructor.name;
  }
  console.log(name + ": " + text);
}

type Sizes = { a: number; width?: number; ratio?: number | null; count?: number };

function merge(into: Sizes, from: any): Sizes {
  return Object.assign(into, from);
}
function area(sizes: Sizes): number {
  return (sizes.width ?? 1) * 0.5 + (sizes.ratio ?? 2) * 1.5 + sizes.a;
}
function nameOf(sizes: Sizes): string {
  return ["zero", "one", "two", "three"][sizes.count ?? 0] ?? "many";
}
function show(sizes: Sizes) {
  return [Object.keys(sizes).join(), sizes.width, sizes.ratio, sizes.count, area(sizes), nameOf(sizes)];
}

const numbers = [0, 1, -1, 0.5, -0, NaN, Infinity, -Infinity, 2 ** 31, -(2 ** 31) - 1, 2 ** 53, 1e300, 5e-324];
say("every kind of number into absent fields", () => numbers.map(n => show(merge({ a: 1 }, { width: n, ratio: n, count: 2 }))));
say("every kind of number over numbers", () => numbers.map(n => show(merge({ a: 1, width: 3, ratio: 4, count: 1 }, { ratio: n, width: n }))));
say("nothing into absent fields", () => [show(merge({ a: 1 }, { width: undefined, ratio: null })), show(merge({ a: 1 }, { ratio: undefined, count: undefined }))]);
say("nothing over numbers, numbers over nothing", () => {
  const made = merge({ a: 1, width: 3, ratio: 4 }, { width: undefined, ratio: null });
  return [show(made), show(merge(made, { width: 7.5, ratio: 8 }))];
});
say("the order of the keys is the order of creation", () => [show(merge({ a: 1 }, { ratio: 1, width: 2 })), show(merge({ a: 1 }, { count: 1, width: 2, ratio: 3 }))]);
say("deleted, then assigned", () => {
  const made = merge({ a: 1, width: 3, ratio: 4 }, {});
  delete made.width;
  return [show(made), show(merge(made, { width: 9.25 }))];
});
say("what is no number", () => {
  const results: unknown[] = [];
  for (const width of ["3", true, {}, 3n]) {
    try {
      results.push(typeof merge({ a: 1 }, { width }).width);
    } catch (error) {
      results.push((error as Error).constructor.name);
    }
  }
  return results.length;
});
say("many, in turn", () => {
  let total = 0;
  const sources: any[] = [{ width: 1.5 }, { ratio: 2, width: 3 }, { count: 3, ratio: 0.25 }, { width: undefined }, { a: 4.5, ratio: null }];
  for (let i = 0; i < 5000; i++) {
    const made = merge(i & 8 ? { a: i, width: i } : { a: i }, sources[i % sources.length]);
    total += area(made) + Object.keys(made).length + nameOf(made).length;
  }
  return total;
});
