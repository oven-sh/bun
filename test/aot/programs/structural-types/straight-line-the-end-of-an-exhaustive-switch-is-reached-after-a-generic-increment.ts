interface Dial {
  step: 1 | 2;
}

function bump<K extends string>(target: Record<K, number>, key: K): void {
  target[key] += 1;
}

function nameOf(dial: Dial): string {
  switch (dial.step) {
    case 1:
      return "one";
    case 2:
      return "two";
  }
}

function chain(dial: Dial): string {
  if (dial.step === 1) return "one";
  if (dial.step === 2) return "two";
  const never: never = dial.step;
  return "never " + String(never);
}

const dial: Dial = { step: 1 };
console.log(nameOf(dial));
console.log(chain(dial));
bump(dial, "step");
console.log(nameOf(dial));
console.log(chain(dial));
bump(dial, "step");
console.log(dial.step);
console.log(typeof nameOf(dial));
console.log(nameOf(dial));
console.log(chain(dial));
console.log(dial.step === 1 || dial.step === 2);
console.log(dial.step !== 1 && dial.step !== 2);
console.log(dial.step > 2);
console.log(JSON.stringify(dial));

export {};
