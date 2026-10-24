// Setters that hundreds of classes inherit, stored to in turn at one place: every store reaches its setter, also behind changes to the classes.
let log = 0;
class Base {
  #first = 0;
  #second = 0;
  set first(value) {
    this.#first = value;
    log += 1;
  }
  get first() {
    return this.#first;
  }
  set second(value) {
    this.#second = value * 2;
    log += 2;
  }
  get second() {
    return this.#second;
  }
}
function write(object, value) {
  object.first = value;
  object.second = value;
}
for (const shapes of [1, 3, 40, 70, 130, 300, 700, 2500]) {
  const made = [];
  const classes = [];
  for (let i = 0; i < shapes; i++) {
    const heir = class extends Base {};
    classes.push(heir);
    made.push(new heir());
  }
  log = 0;
  for (let round = 0; round < 4; round++) for (let i = 0; i < made.length; i++) write(made[i], round * 1000 + i);
  let sum = 0;
  for (const object of made) sum += object.first + object.second;
  console.log(shapes, "classes:", log, sum);
  let own = 0;
  for (let i = 0; i < shapes; i += 7) Object.defineProperty(classes[i].prototype, "first", { set(value) { own += value; }, configurable: true });
  for (let i = 3; i < shapes; i += 7) Object.defineProperty(made[i], "second", { value: -1, writable: true, configurable: true });
  log = 0;
  for (let round = 0; round < 3; round++) for (let i = 0; i < made.length; i++) write(made[i], i);
  sum = 0;
  for (const object of made) sum += (object.first ?? 0) + object.second;
  console.log(shapes, "classes, every seventh with a setter of its own, every seventh object with a property of its own:", log, own, sum);
}
