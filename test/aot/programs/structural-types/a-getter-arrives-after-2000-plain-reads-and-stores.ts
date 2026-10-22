interface Cell {
  value: number;
  next: number;
}

const log: string[] = [];

function read(c: Cell): number {
  return c.value;
}

function write(c: Cell, v: number): void {
  c.value = v;
}

function shift(c: Cell): number {
  c.value = c.next;
  c.next = c.value + 1;
  return c.value;
}

function accumulate(cells: Cell[]): number {
  let sum = 0;
  for (let i = 0; i < cells.length; i++) sum += cells[i].value;
  return sum;
}

function flush(label: string, value: unknown): void {
  console.log(label + ": " + String(value) + " [" + log.join(", ") + "]");
  log.length = 0;
}

function accessor(): Cell {
  let stored = 100;
  return {
    get value() {
      log.push("get value");
      return stored;
    },
    set value(v: number) {
      log.push("set value " + v);
      stored = v * 2;
    },
    next: 5,
  };
}

const plain: Cell = { value: 0, next: 1 };
let sum = 0;
for (let i = 0; i < 2000; i++) {
  write(plain, i);
  sum += read(plain) + shift(plain);
}
flush("2000 honest rounds", sum);

const odd = accessor();
flush("read", read(odd));
flush("write", write(odd, 7));
flush("read back", read(odd));
flush("shift", shift(odd));
flush("plain again", (write(plain, 3), read(plain)));
flush("odd again", read(odd));

const many: Cell[] = [];
for (let i = 0; i < 2000; i++) many.push({ value: 1, next: 0 });
flush("2000 plain elements", accumulate(many));
many[1000] = accessor();
flush("one accessor among them", accumulate(many));
many[1000] = { next: 0, value: 1 };
flush("one of another order among them", accumulate(many));

const turning: Cell = { value: 1, next: 2 };
const seen: number[] = [];
for (let i = 0; i < 6; i++) {
  seen.push(read(turning));
  if (i === 2) {
    Object.defineProperty(turning, "value", {
      get() {
        log.push("late getter");
        return -1;
      },
      set(v: number) {
        log.push("late setter " + v);
      },
      enumerable: true,
      configurable: true,
    });
  }
  write(turning, i + 10);
}
flush("one object turns in the middle of a loop", seen.join());

Object.defineProperty(turning, "value", { value: 50, writable: true, enumerable: true, configurable: true });
flush("and turns back", (write(turning, 51), read(turning)));

class Box {
  cell: Cell = { value: 1, next: 1 };
  read(): number {
    return this.cell.value + this.cell.next;
  }
}

const box = new Box();
let boxed = 0;
for (let i = 0; i < 2000; i++) boxed += box.read();
flush("2000 reads through a field", boxed);
box.cell = accessor();
flush("the field now holds the accessor", box.read());

export {};
