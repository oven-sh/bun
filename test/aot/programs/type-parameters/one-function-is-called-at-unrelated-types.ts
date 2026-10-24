// What one call puts for a type parameter says nothing of another call: a number here, an object there, a function, nothing at all.
class Item {
  name = "item";
  size = 3;
}

class Other {
  label = "other";
}

function same<T>(value: T): T {
  return value;
}

function first<T>(list: T[]): T {
  return list[0];
}

function pick<T>(left: T, right: T, takesLeft: boolean): T {
  return takesLeft ? left : right;
}

function twice<T>(value: T, change: (value: T) => T): T {
  return change(change(value));
}

function run(turn: number): string {
  const lines: unknown[] = [
    same(turn) + 1,
    same("text").length,
    same(new Item()).size + turn,
    same(new Other()).label,
    same(undefined),
    same(null),
    same((n: number) => n * 2)(turn),
    first([turn, 2]) * 2,
    first([new Item()]).name,
    first(["a", "b"]).toUpperCase(),
    first<number>([]),
    pick(new Item(), new Item(), turn > 0).size,
    pick(1.5, turn, false) + 0.25,
    pick("left", "right", turn === 1),
    twice(turn, n => n + 1),
    twice("x", s => s + "y"),
    twice(new Item(), item => ((item.size += 1), item)).size,
  ];
  return lines.map(String).join(" ");
}

for (let turn = 0; turn < 3; turn++) console.log(run(turn));
