const log: string[] = [];

class Closed extends Array<number> {
  [Symbol.isConcatSpreadable] = false;
}

class Asking extends Array<number> {
  get [Symbol.isConcatSpreadable](): boolean {
    log.push("asked");
    return this.length % 2 === 0;
  }
}

class Shelf {
  [index: number]: string;
  length = 2;
  0 = "a";
  1 = "b";
  [Symbol.isConcatSpreadable] = true;
}

class ClosedShelf {
  [index: number]: string;
  length = 2;
  0 = "a";
  1 = "b";
}

function show(list: readonly unknown[]): string {
  const parts: string[] = [];
  for (let i = 0; i < list.length; i++) parts.push(!(i in list) ? "hole" : Array.isArray(list[i]) ? "[" + String(list[i]) + "]" : typeof list[i] === "object" ? "object" : String(list[i]));
  return list.length + ": " + parts.join(" ");
}

function line(label: string, value: string): void {
  console.log(label + ": " + value + " {" + log.join() + "}");
  log.length = 0;
}

function joinNumbers(a: number[], b: number[]): number[] {
  return a.concat(b);
}

function of<T extends number[]>(list: T, ...items: number[]): T {
  for (const item of items) list[list.length] = item;
  return list;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += joinNumbers([1, 2], [3]).length;
line("2000 honest", String(warm));

line("plain and plain", show(joinNumbers([1, 2], [3, 4])));
line("plain and closed", show(joinNumbers([1, 2], of(new Closed(), 3, 4))));
line("closed and plain", show(joinNumbers(of(new Closed(), 1, 2), [3, 4])));
line("closed and closed", show(joinNumbers(of(new Closed(), 1), of(new Closed(), 2))));
line("what it makes", joinNumbers(of(new Closed(), 1), [2]).constructor.name);
line("asking, two elements", show(joinNumbers([0], of(new Asking(), 1, 2))));
line("asking, three elements", show(joinNumbers([0], of(new Asking(), 1, 2, 3))));
line("asking as the receiver", show(joinNumbers(of(new Asking(), 1), [2])));

const words: (string | Shelf | ClosedShelf)[] = ["x"];
line("an object that says it is spreadable", show(words.concat(new Shelf())));
line("the same shape without the symbol", show(words.concat(new ClosedShelf())));

const shelf = new Shelf();
shelf.length = 4;
line("a longer length makes holes", show(words.concat(shelf)));
shelf[Symbol.isConcatSpreadable] = false;
line("switched off", show(words.concat(shelf)));

const switched = of(new Closed(), 5, 6);
line("closed", show(joinNumbers([], switched)));
switched[Symbol.isConcatSpreadable] = true;
line("switched on", show(joinNumbers([], switched)));
Reflect.deleteProperty(switched, Symbol.isConcatSpreadable);
line("the member removed", show(joinNumbers([], switched)));

const plain = [7, 8];
Object.defineProperty(plain, Symbol.isConcatSpreadable, { value: false, configurable: true });
line("a plain array with an own member", show(joinNumbers([], plain)) + " | " + show(joinNumbers(plain, [9])) + " | " + show([...plain]) + " | " + show([plain].flat()));
Reflect.deleteProperty(plain, Symbol.isConcatSpreadable);
line("removed", show(joinNumbers([], plain)));

export {};
