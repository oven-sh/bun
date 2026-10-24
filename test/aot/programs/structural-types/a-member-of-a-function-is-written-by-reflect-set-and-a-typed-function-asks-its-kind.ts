interface Counter {
  (step: number): number;
  calls: number;
}

function isNumber(c: Counter): boolean {
  return typeof c.calls === "number";
}

const written: Counter = Object.assign((step: number): number => step * 2, { calls: 0 });
Reflect.set(written, "calls", "text");
console.log(isNumber(written));

export {};
