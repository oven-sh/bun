const log: string[] = [];

function add(list: number[], n: number): number {
  return list.push(n);
}

function doubled(list: number[]): number[] {
  return list.map(n => n * 2);
}

function has(list: number[], n: number): boolean {
  return list.includes(n);
}

function text(list: number[]): string {
  return list.join("-");
}

function take(list: number[]): number | undefined {
  return list.pop();
}

function each(list: number[]): string {
  const seen: number[] = [];
  list.forEach(n => seen.push(n));
  return seen.join();
}

function all(list: number[]): string {
  return [add(list, 9), doubled(list).join(), has(list, 2), text(list), take(list), each(list), list.length, JSON.stringify(list), Object.keys(list).join()].join(" | ");
}

function round(label: string, list: number[]): void {
  log.length = 0;
  console.log(label + ": " + all(list) + " {" + log.join(", ") + "}");
}

const honest = [1, 2, 3];
const changed = [1, 2, 3];
let warm = 0;
for (let i = 0; i < 2000; i++) {
  warm += add(changed, i) + doubled(changed).length + text(honest).length;
  take(changed);
}
console.log("2000 honest: " + warm);
round("before", changed);

changed.push = (...items) => {
  log.push("own push " + items.join());
  return 42;
};
round("an own push", changed);

changed.map = () => {
  log.push("own map");
  return [];
};
round("an own map", changed);

changed.includes = () => true;
changed.join = separator => "joined with " + separator;
changed.pop = () => -1;
changed.forEach = () => {
  log.push("own forEach");
};
round("four more", changed);
round("the honest one", honest);

for (const name of ["push", "map", "includes", "join", "pop", "forEach"]) Reflect.deleteProperty(changed, name);
round("all removed", changed);

const borrowed = [1, 2, 3];
borrowed.push = borrowed.unshift;
round("push is unshift", borrowed);

const bound = [1, 2, 3];
bound.push = honest.push.bind(honest);
round("push is bound to another array", bound);
console.log("the other array: " + JSON.stringify(honest));

class Holder {
  list: number[] = [1, 2, 3];
  add(n: number): number {
    return this.list.push(n);
  }
}

const holder = new Holder();
console.log("a field: " + holder.add(4) + " " + JSON.stringify(holder.list));
holder.list.push = () => -7;
console.log("its push covered: " + holder.add(5) + " " + JSON.stringify(holder.list));
console.log("another holder: " + new Holder().add(4));

export {};
