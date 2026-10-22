// A member of a generic class or interface is also what an heir or an implementer makes of it, and that one is written for one type only: what it hands out
// need not be anything that came in.
class Item {
  constructor(public name: string) {}
}

class Box<T> {
  constructor(public value: T) {}
  get(): T {
    return this.value;
  }
  put(value: T): void {
    this.value = value;
  }
  map<U>(change: (value: T) => U): Box<U> {
    return new Box(change(this.get()));
  }
}

class FreshBox extends Box<Item> {
  made = 0;
  override get(): Item {
    return new Item("fresh " + ++this.made);
  }
}

class CountingBox extends Box<number> {
  override get(): number {
    return this.value++;
  }
}

interface Source<T> {
  next(): T;
}

class Items implements Source<Item> {
  next(): Item {
    return new Item("made");
  }
}

class Numbers implements Source<number> {
  at = 0.5;
  next(): number {
    return (this.at += 1);
  }
}

function take<T>(box: Box<T>): T {
  return box.get();
}

function pull<T>(source: Source<T>): T {
  return source.next();
}

function run(): string {
  const boxes: Box<Item>[] = [new Box(new Item("kept")), new FreshBox(new Item("never seen"))];
  const counts: Box<number>[] = [new Box(7), new CountingBox(1)];
  const lines: unknown[] = [];
  for (const box of boxes) lines.push(take(box).name, box.get().name.length, box.map(item => item.name + "!").get());
  for (const box of counts) lines.push(take(box) + 1, box.get() * 2, box.map(n => n + 0.5).get());
  lines.push(pull(new Items()).name, pull(new Numbers()) + 1, pull<Item | number>(new Numbers()));
  boxes[1].put(new Item("stored"));
  lines.push(boxes[1].value.name, boxes[1].get().name);
  return lines.map(String).join(" | ");
}

for (let turn = 0; turn < 3; turn++) console.log(run());
