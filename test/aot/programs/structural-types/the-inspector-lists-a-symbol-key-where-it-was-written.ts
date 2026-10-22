const tag = Symbol("tag");

const between = { x: 1, [tag]: "t", y: 2 };
const first = { [tag]: "t", x: 1, y: 2 };

class Tagged {
  x = 1;
  [tag] = "t";
  y = 2;
}

console.log(between);
console.log(first);
console.log(new Tagged());
console.log(Bun.inspect(between));
console.log(Reflect.ownKeys(between).map(String).join());
console.log(Reflect.ownKeys(first).map(String).join());
console.log(Reflect.ownKeys({ ...between }).map(String).join());
console.log(Reflect.ownKeys(Object.assign({}, between)).map(String).join());
console.log({ ...between });
console.log(Object.assign({}, first));

export {};
