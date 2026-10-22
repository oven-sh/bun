// One helper, entered directly, by call, apply, bind, Reflect.apply, as a method of two objects, as a callback of built-ins, through a variable that changes, with too few and too many arguments.
function pick(array, index) {
  return array === undefined ? "nothing" : array[index === undefined ? 0 : index];
}
function self() {
  return this;
}
class Cat {
  constructor(name) {
    this.name = name;
  }
}
class Dog {
  constructor(age) {
    this.age = age;
  }
}
const cats = [new Cat("tom"), new Cat("kit")];
const dogs = [new Dog(3), new Dog(5)];
const lines = [];
lines.push(pick(cats, 1).name, pick(dogs, 1).age, pick("text", 2), pick([1.5], 0));
lines.push(pick.call(null, cats, 0).name, pick.apply(null, [dogs, 0]).age, Reflect.apply(pick, undefined, [cats]).name);
const pickDog = pick.bind(null, dogs);
lines.push(pickDog(1).age, pickDog().age);
lines.push(pick(), pick(cats).name, pick(dogs, 1, "more", "than", "it takes").age);
const holder = { pick, items: cats };
lines.push(holder.pick(holder.items, 1).name);
lines.push([cats, dogs].map(pick).map(x => x.name ?? x.age).join());
lines.push([[cats, 1], [dogs, 0]].map(pair => pick(...pair)).map(x => x.name ?? x.age).join());
let current = pick;
for (let i = 0; i < 4; i++) {
  lines.push(String(current(i & 1 ? cats : dogs, 0).name));
  if (i === 1) current = (array, index) => array[index + 1];
}
const cat = cats[0];
const dog = dogs[0];
cat.self = self;
dog.self = self;
lines.push(cat.self().name, dog.self().age, self.call(cat).name, self.call(dog).age, typeof self.call(5), self.bind(dog)().age);
lines.push(new Promise(resolve => resolve(cats)).then(pick) instanceof Promise);
Promise.resolve(dogs).then(pick).then(x => console.log("later " + x.age));
setTimeout(pick, 0, cats, 1);
console.log(lines.join("\n"));
