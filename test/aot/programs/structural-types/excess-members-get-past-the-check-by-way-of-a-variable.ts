interface Options {
  size: number;
  label: string;
}

function summary(o: Options): string {
  return o.label + "/" + o.size + "/" + Object.keys(o).join() + "/" + JSON.stringify(o);
}

function identity<T>(value: T): T {
  return value;
}

function build(): { debug: boolean; size: number; label: string; depth: number } {
  return { debug: true, size: 2, label: "built", depth: 9 };
}

class Widget {
  options: Options;
  constructor(options: Options) {
    this.options = options;
  }
  summary(): string {
    return summary(this.options);
  }
}

const variable = { color: "red", size: 1, label: "variable" };
console.log("a variable: " + summary(variable));

console.log("a result: " + summary(build()));

console.log("a generic call: " + summary(identity({ size: 3, label: "generic", extra: [1, 2] })));

const spreadSource = { size: 4, label: "spread", more: "more" };
console.log("a spread in the literal: " + summary({ ...spreadSource }));
console.log("a spread and a member: " + summary({ ...spreadSource, size: 40 }));

const list = [{ size: 5, label: "element", index: 0 }];
console.log("an element: " + summary(list[0]));

const nested = { inner: { label: "nested", other: null, size: 6 } };
console.log("a member: " + summary(nested.inner));

const other = { first: 1, size: 7, label: "conditional" };
console.log("a conditional: " + summary(list.length > 0 ? other : variable));

const assigned = Object.assign({ size: 8, label: "assigned" }, { late: true });
console.log("Object.assign: " + summary(assigned));

const [destructured] = [{ label: "destructured", size: 9, tail: "tail" }];
console.log("a pattern: " + summary(destructured));

class Rich {
  hidden = "hidden";
  size = 10;
  label = "instance";
  extra = 0;
}
console.log("an instance: " + summary(new Rich()));

console.log("a field: " + new Widget(variable).summary());
console.log("a field from a result: " + new Widget(build()).summary());

const all: Options[] = [variable, build(), spreadSource, list[0], nested.inner, assigned, destructured, new Rich()];
console.log("all sizes: " + all.map(o => o.size).join());
console.log("all labels: " + all.map(o => o.label).join());
console.log("all counts: " + all.map(o => Object.keys(o).length).join());
console.log("all as json: " + JSON.stringify(all));

const captured = () => summary(variable) + " " + summary(all[1]);
console.log("captured: " + captured());

let widest: Options = { size: 0, label: "none" };
for (const o of all) if (Object.keys(o).length > Object.keys(widest).length) widest = o;
console.log("the widest: " + summary(widest));
