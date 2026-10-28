const prototype = {
  extra: "inherited",
  get second() {
    return "getter";
  },
  set second(value) {
    Object.defineProperty(this, "second", { value, writable: true, configurable: true, enumerable: true });
  },
};

function create(value) {
  const holder = Object.create(prototype);
  holder.extra = value;
  holder.second = value + 1;
  holder.third = undefined;
  return holder;
}

function read(holder) {
  return holder.extra + ":" + holder.second + ":" + holder.third;
}

let last = "";
for (let i = 0; i < 1000; i++) last = read(create(i));
console.log(last);

const deleted = create(1);
delete deleted.extra;
delete deleted.second;
delete deleted.third;
console.log(read(deleted));

const redefined = create(2);
Object.defineProperty(redefined, "extra", { get() { return "own getter"; } });
console.log(read(redefined));

console.log(read(Object.create(prototype)));
console.log(read(Object.create(create(3))));

const moved = create(4);
delete moved.extra;
Object.setPrototypeOf(moved, { extra: "other prototype" });
console.log(read(moved));

prototype.third = "late";
const emptied = create(5);
console.log(read(emptied));
delete emptied.third;
console.log(read(emptied), Object.keys(emptied).join());
