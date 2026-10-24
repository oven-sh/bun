interface Gauge {
  level: number;
}

function next(g: Gauge): number {
  return g.level + 1;
}

let stored = 0;
const writeOnly: Gauge = {
  set level(value: number) {
    stored = value;
  },
};

console.log(next({ level: 1 }));
console.log(next(writeOnly));
console.log(typeof writeOnly.level);
writeOnly.level = 7;
console.log(stored);
console.log(next(writeOnly));

export {};
