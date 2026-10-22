// `item.name + ":" + item.count` joins each of its three parts once, also where the object comes out of a field that may hold undefined.
class Item {
  name: string;
  count: number;

  constructor(name: string, count: number) {
    this.name = name;
    this.count = count;
  }
}

class Special extends Item {
  extra: boolean;

  constructor(name: string, count: number, extra: boolean) {
    super(name, count);
    this.extra = extra;
  }
}

class Box<T> {
  value: T;

  constructor(value: T) {
    this.value = value;
  }
}

function summarize(box: Box<Item | undefined>): string {
  const item = box.value;
  return item === undefined ? "empty" : item.name + ":" + item.count;
}

const optional = new Box<Item | undefined>(undefined);
console.log(summarize(optional));
optional.value = new Item("first", 1);
console.log(summarize(optional));
optional.value = new Special("second", 2, true);
console.log(summarize(optional));
