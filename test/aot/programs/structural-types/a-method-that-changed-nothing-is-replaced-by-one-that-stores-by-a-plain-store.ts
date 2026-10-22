class Cell {
  value = 1;
  text = "one";
  list: number[] = [1, 2, 3, 4];
  inner = { depth: 1 };
  touch(): void {}
}

function storing(this: Cell): void {
  this.value += 10;
  this.text += "!";
  this.list.pop();
  this.inner.depth++;
}

function swapping(this: Cell): void {
  this.list = [9, 9];
  this.inner = { depth: -1 };
}

function around(c: Cell): string {
  const a = c.value;
  const s = c.text;
  c.touch();
  return a + " " + c.value + " " + s + " " + c.text;
}

function lengths(c: Cell): string {
  const list = c.list;
  const n = list.length;
  c.touch();
  return n + " " + list.length + " " + c.list.length + " " + (list === c.list) + " " + String(list[n - 1]);
}

function nested(c: Cell): string {
  const inner = c.inner;
  const d = inner.depth;
  c.touch();
  return d + " " + inner.depth + " " + c.inner.depth + " " + (inner === c.inner);
}

function loop(c: Cell): string {
  const seen: string[] = [];
  for (let i = 0; i < c.list.length; i++) {
    seen.push(String(c.list[i]));
    c.touch();
  }
  return seen.join();
}

function sum(c: Cell): number {
  return c.value + (c.touch(), c.value) + c.value;
}

function round(label: string): void {
  console.log(label + ": " + around(new Cell()) + " | " + lengths(new Cell()) + " | " + nested(new Cell()) + " | " + loop(new Cell()) + " | " + sum(new Cell()));
}

const original = Cell.prototype.touch;
let warm = 0;
for (let i = 0; i < 2000; i++) warm += around(new Cell()).length + lengths(new Cell()).length + loop(new Cell()).length + sum(new Cell());
console.log("2000 honest: " + warm);
round("the method");
Cell.prototype.touch = storing;
round("one that stores into the fields");
Cell.prototype.touch = swapping;
round("one that replaces the array and the object");
Cell.prototype.touch = original;
round("put back");

export {};
