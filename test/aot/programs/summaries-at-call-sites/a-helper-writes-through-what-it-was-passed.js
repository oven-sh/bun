// A helper stores one parameter into what another leads to: each caller's own objects get each caller's own values; a setter, a frozen object, a proxy and an array stand in the way.
function link(node, next) {
  node.next = next;
  return node;
}
function setDeep(root, value) {
  root.inner.slot = value;
}
function register(table, name, handler) {
  table[name] = handler;
}
function fire(table, name, operand) {
  return table[name](operand);
}
function append(list, item) {
  list[list.length] = item;
  return list.length;
}
class Car {
  constructor(id) {
    this.id = id;
    this.next = undefined;
  }
}
class Ship {
  constructor(name) {
    this.name = name;
    this.next = null;
  }
}
const lines = [];
for (let i = 0; i < 3; i++) {
  const cars = link(new Car(i), new Car(i + 1));
  const ships = link(new Ship("s" + i), new Ship("t" + i));
  const crossed = link(new Car(9), new Ship("x"));
  lines.push(cars.next.id + " " + ships.next.name + " " + crossed.next.name + " " + link({}, 5).next);
  const withSetter = { set next(value) { lines.push("setter got " + (value.id ?? value.name ?? value)); } };
  link(withSetter, new Car(70 + i));
  link(withSetter, "text");
  try {
    lines.push(String(link(Object.freeze({ next: "frozen" }), new Car(1)).next));
  } catch (error) {
    lines.push(error.constructor.name);
  }
  const a = { inner: { slot: 0 } };
  const b = { inner: { slot: "" } };
  setDeep(a, new Car(i));
  setDeep(b, new Ship("deep"));
  lines.push(a.inner.slot.id + " " + b.inner.slot.name);
  const carTable = {};
  const shipTable = Object.create(null);
  register(carTable, "go", car => car.id * 2);
  register(shipTable, "go", ship => ship.name + "!");
  register(shipTable, "stop", () => "stopped");
  lines.push(fire(carTable, "go", new Car(i)) + " " + fire(shipTable, "go", new Ship("f")) + " " + fire(shipTable, "st" + "op"));
  const carList = [];
  const mixedList = ["a"];
  lines.push(append(carList, new Car(i)) + " " + append(mixedList, new Ship("m")) + " " + carList[0].id + " " + mixedList[1].name + " " + mixedList[0]);
  const seen = [];
  const proxy = new Proxy({}, { set(target, key, value) { seen.push(String(key) + "=" + (value.id ?? value)); return true; } });
  link(proxy, new Car(5));
  register(proxy, "name", 7);
  lines.push(seen.join());
}
console.log(lines.join("\n"));
