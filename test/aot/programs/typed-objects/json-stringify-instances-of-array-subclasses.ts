// JSON.stringify meets instances of classes that extend Array, alone and inside typed records: with and without toJSON, whoever defines it and whenever.
interface Label { id: number; name: string }
interface Issue { id: number; title: string; labels: Label[]; numbers: number[]; made: Date | null }
class Rows<T> extends Array<T> {
  count = 0;
  command = "SELECT";
}
class MoreRows<T> extends Rows<T> {
  more = true;
}
class Told<T> extends Array<T> {
  toJSON() {
    return "told " + this.length;
  }
}
class LaterTold<T> extends Array<T> {}
class LaterToldAbove<T> extends LaterTold<T> {}
function hide(value: unknown): any {
  return value;
}
function fill<T, L extends T[]>(list: L, ...items: T[]): L {
  for (const item of items) list.push(item);
  return list;
}
const label = (id: number, name = "label " + id): Label => ({ id, name });
const issue = (id: number, labels: Label[], numbers: number[] = []): Issue => ({ id, title: "issue " + id, labels, numbers, made: id % 2 ? new Date(86400000 * id) : null });
function show(name: string, make: () => unknown) {
  for (let turn = 0; turn < 2; turn++) {
    try {
      console.log(name, String(make()));
    } catch (error) {
      console.log(name, "throws", (error as Error).constructor.name, (error as Error).message);
    }
  }
}
const rows = () => fill(new Rows<Label>(), label(1), label(2, 'quoted "two"'), label(3, "wide 東京 😀"));
show("alone", () => JSON.stringify(rows()));
show("alone, indented", () => JSON.stringify(rows(), null, 2));
show("alone, with a replacer", () => JSON.stringify(rows(), (key, value) => (key === "id" ? undefined : value)));
show("alone, with a list of keys", () => JSON.stringify(rows(), ["name"]));
show("empty", () => JSON.stringify(new Rows<Label>()));
show("in a record", () => JSON.stringify(issue(1, rows())));
show("in records in a list", () => JSON.stringify([issue(1, rows()), issue(2, new Rows<Label>()), issue(3, [label(4)])]));
show("in records in an instance", () => JSON.stringify(fill(new Rows<Issue>(), issue(1, rows()), issue(2, rows()))));
show("a subclass of the subclass", () => JSON.stringify(issue(4, fill(new MoreRows<Label>(), label(5)))));
show("numbers", () => JSON.stringify(issue(5, [], fill(new Rows<number>(), 1, 2, 3))));
show("numbers that are not whole", () => JSON.stringify(issue(5, [], fill(new Rows<number>(), 1.5, -0, NaN, Infinity, 1e21))));
show("strings", () => JSON.stringify({ list: fill(new Rows<string>(), "a", "é", "東", "\ud800", "\n") }));
show("instances in an instance", () => JSON.stringify(fill(new Rows<Rows<number>>(), fill(new Rows<number>(), 1), new Rows<number>(), fill(new Rows<number>(), 2, 3))));
show("objects without a type", () => JSON.stringify(fill(new Rows<unknown>(), JSON.parse('{"a":1,"b":[true,null]}'), JSON.parse('{"c":"東"}'))));
show("objects without a type, in a record", () => JSON.stringify({ id: 1, held: fill(new Rows<unknown>(), JSON.parse('{"a":1}'), label(6), "text", 7, null, undefined, () => 1, Symbol("s")) }));
show("the result of map", () => JSON.stringify(issue(6, rows().map(each => label(each.id + 10)))));
show("the result of filter and slice", () => JSON.stringify([rows().filter(each => each.id > 1), rows().slice(1)]));
show("toJSON of the class", () => JSON.stringify(issue(7, fill(new Told<Label>(), label(8)))));
show("toJSON of the class, alone", () => JSON.stringify(fill(new Told<Label>(), label(8))));
show("toJSON of its own", () => {
  const list = rows();
  hide(list).toJSON = () => "own";
  return JSON.stringify(issue(8, list));
});
show("toJSON of its own that is no function", () => {
  const list = rows();
  hide(list).toJSON = 1;
  return JSON.stringify(issue(8, list));
});
show("a getter named toJSON", () => {
  const list = rows();
  Object.defineProperty(list, "toJSON", { get: () => () => "got" });
  return JSON.stringify(issue(8, list));
});
const later = () => fill(new LaterToldAbove<Label>(), label(9));
show("before the class is told", () => JSON.stringify(issue(9, later())));
hide(LaterTold.prototype).toJSON = function (this: unknown[]) {
  return "told later " + this.length;
};
show("after the class above is told", () => JSON.stringify(issue(9, later())));
delete hide(LaterTold.prototype).toJSON;
show("after that is taken back", () => JSON.stringify(issue(9, later())));
show("a hole", () => {
  const list = rows();
  delete hide(list)[1];
  return JSON.stringify(issue(10, list));
});
show("a hole over an inherited element", () => {
  const list = rows();
  delete hide(list)[1];
  hide(Rows.prototype)[1] = label(99);
  try {
    return JSON.stringify(issue(10, list));
  } finally {
    delete hide(Rows.prototype)[1];
  }
});
show("a longer length", () => {
  const list = rows();
  list.length = 5;
  return JSON.stringify(issue(11, list));
});
show("an element with a getter", () => {
  const list = rows();
  Object.defineProperty(list, 1, { get: () => label(77), enumerable: true });
  return JSON.stringify(issue(12, list));
});
show("frozen", () => JSON.stringify(issue(13, Object.freeze(rows()) as Label[])));
show("another prototype", () => JSON.stringify(issue(14, Object.setPrototypeOf([label(1)], Rows.prototype))));
show("no prototype", () => JSON.stringify(issue(14, Object.setPrototypeOf([label(1)], null))));
show("a prototype with toJSON", () => JSON.stringify(issue(14, Object.setPrototypeOf([label(1)], { toJSON: () => "from the prototype" }))));
show("a proxy as the prototype", () => JSON.stringify(issue(14, Object.setPrototypeOf([label(1)], new Proxy(Array.prototype, { get: (target, key, receiver) => (key === "toJSON" ? () => "through the proxy" : Reflect.get(target, key, receiver)) })))));
show("a proxy of an instance", () => JSON.stringify({ id: 15, held: hide(new Proxy(rows(), {})) }));
show("an instance that holds itself", () => {
  const list = new Rows<unknown>();
  list.push(list);
  return JSON.stringify({ list });
});
show("a record that holds itself through an instance", () => {
  const one = issue(16, []);
  one.labels = fill(new Rows<Label>(), hide(one));
  return JSON.stringify(one);
});
let deep: unknown[] = new Rows<unknown>();
for (let i = 0; i < 100; i++) deep = fill<unknown, Rows<unknown>>(new Rows<unknown>(), deep, i);
show("a hundred levels", () => JSON.stringify({ deep })!.length);
let length = 0;
for (let i = 0; i < 20000; i++) length += JSON.stringify(issue(i, fill(new Rows<Label>(), label(i), label(i + 1)), fill(new Rows<number>(), i)))!.length;
console.log("many", length);
