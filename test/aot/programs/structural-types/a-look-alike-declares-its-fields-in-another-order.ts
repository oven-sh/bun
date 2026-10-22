class Vector {
  x = 1;
  y = 2;
  z = 3;
}

class Reversed {
  z = 30;
  y = 20;
  x = 10;
}

class Padded {
  id = "padded";
  x = 100;
  weight = 0.5;
  y = 200;
  tags: string[] = [];
  z = 300;
}

class FromConstructor {
  z: number;
  x: number;
  y: number;
  constructor() {
    this.y = 2000;
    this.x = 1000;
    this.z = 3000;
  }
}

class Base {
  y = 20000;
}

class Derived extends Base {
  z = 30000;
  x = 10000;
}

function digits(v: Vector): number {
  return v.x + v.y + v.z;
}

function first(v: Vector): number {
  return v.x;
}

function last(v: Vector): number {
  return v.z;
}

function scale(v: Vector, by: number): void {
  v.x *= by;
  v.y *= by;
  v.z *= by;
}

function setFirst(v: Vector, value: number): void {
  v.x = value;
}

class Holder {
  constructor(public vector: Vector) {}
  first(): number {
    return this.vector.x;
  }
  last(): number {
    return this.vector.z;
  }
}

function all(): Vector[] {
  return [new Vector(), new Reversed(), new Padded(), new FromConstructor(), new Derived(), { y: 5, z: 6, x: 4 }];
}

for (const v of all()) {
  const name = v.constructor.name;
  console.log(name + ": first " + first(v) + " last " + last(v) + " all " + digits(v));
  console.log(name + ": keys " + Object.keys(v).join() + " json " + JSON.stringify(v));
  console.log(name + ": field " + new Holder(v).first() + " " + new Holder(v).last());
  console.log(name + ": copy " + JSON.stringify({ ...v }));
  console.log(name + ": instanceof Vector " + (v instanceof Vector));
}

for (const v of all()) {
  scale(v, 2);
  setFirst(v, -1);
  console.log(v.constructor.name + ", stored: " + JSON.stringify(v));
}

let total = 0;
for (let i = 0; i < 2000; i++) total += first(new Vector()) + last(new Vector());
console.log("2000 honest: " + total);
console.log("then: " + all().map(first).join() + " | " + all().map(last).join());

const local: Vector = new Reversed();
console.log("local: " + local.x + " " + local.y + " " + local.z);
local.x = 7;
console.log("local after a store: " + JSON.stringify(local));
const captured = () => local.z - local.x;
console.log("captured: " + captured());

export {};
