function create<T>(ctor: new () => T): T {
  return new ctor();
}

const spare = { x: "spare", y: 20 };
const standIn = { x: 10, y: 20, extra: true };

class Point {
  x = 1;
  y = 2;
}

class Odd {
  x = 1;
  y = 2;
  constructor() {
    return standIn;
  }
}

const trapped = new Proxy(Point, {
  construct() {
    return spare;
  },
});

const honest = create(Point);
console.log(honest.x + honest.y);
const odd = create(Odd);
console.log(odd instanceof Odd);
console.log(odd.x + odd.y);
console.log(Object.keys(odd).join());
console.log(JSON.stringify(odd));
const direct = new Odd();
console.log(direct.x + direct.y);
console.log(Object.keys(direct).join());
const fromTheTrap = create(trapped);
console.log(fromTheTrap instanceof Point);
console.log(typeof fromTheTrap.x);
console.log(fromTheTrap.x + 1);
console.log(fromTheTrap.x * 2);
console.log(fromTheTrap.y + 1);
const directly = new trapped();
console.log(typeof directly.x);
console.log(directly.x + 1);

export {};
