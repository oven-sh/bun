interface Wide {
  k0?: number;
  k1?: number;
  k2?: number;
  k3?: number;
  k4?: number;
  k5?: number;
  k6?: number;
  k7?: number;
  k8?: number;
  k9?: number;
  k10?: number;
  k11?: number;
  k12?: number;
  k13?: number;
  k14?: number;
  k15?: number;
  k16?: number;
  k17?: number;
  k18?: number;
  k19?: number;
}

type Key = keyof Wide;

class Roomy {
  declare k0?: number;
  declare k1?: number;
  declare k2?: number;
  declare k3?: number;
  declare k4?: number;
  declare k5?: number;
  declare k6?: number;
  declare k7?: number;
  declare k8?: number;
  declare k9?: number;
  declare k10?: number;
  declare k11?: number;
  declare k12?: number;
  declare k13?: number;
  declare k14?: number;
  declare k15?: number;
  declare k16?: number;
  declare k17?: number;
  declare k18?: number;
  declare k19?: number;
}

const setters: Record<Key, (w: Wide, v: number) => void> = {
  k0: (w, v) => { w.k0 = v; },
  k1: (w, v) => { w.k1 = v; },
  k2: (w, v) => { w.k2 = v; },
  k3: (w, v) => { w.k3 = v; },
  k4: (w, v) => { w.k4 = v; },
  k5: (w, v) => { w.k5 = v; },
  k6: (w, v) => { w.k6 = v; },
  k7: (w, v) => { w.k7 = v; },
  k8: (w, v) => { w.k8 = v; },
  k9: (w, v) => { w.k9 = v; },
  k10: (w, v) => { w.k10 = v; },
  k11: (w, v) => { w.k11 = v; },
  k12: (w, v) => { w.k12 = v; },
  k13: (w, v) => { w.k13 = v; },
  k14: (w, v) => { w.k14 = v; },
  k15: (w, v) => { w.k15 = v; },
  k16: (w, v) => { w.k16 = v; },
  k17: (w, v) => { w.k17 = v; },
  k18: (w, v) => { w.k18 = v; },
  k19: (w, v) => { w.k19 = v; },
};

const removers: Record<Key, (w: Wide) => boolean> = {
  k0: w => delete w.k0,
  k1: w => delete w.k1,
  k2: w => delete w.k2,
  k3: w => delete w.k3,
  k4: w => delete w.k4,
  k5: w => delete w.k5,
  k6: w => delete w.k6,
  k7: w => delete w.k7,
  k8: w => delete w.k8,
  k9: w => delete w.k9,
  k10: w => delete w.k10,
  k11: w => delete w.k11,
  k12: w => delete w.k12,
  k13: w => delete w.k13,
  k14: w => delete w.k14,
  k15: w => delete w.k15,
  k16: w => delete w.k16,
  k17: w => delete w.k17,
  k18: w => delete w.k18,
  k19: w => delete w.k19,
};

const readers: Record<Key, (w: Wide) => number | undefined> = {
  k0: w => w.k0,
  k1: w => w.k1,
  k2: w => w.k2,
  k3: w => w.k3,
  k4: w => w.k4,
  k5: w => w.k5,
  k6: w => w.k6,
  k7: w => w.k7,
  k8: w => w.k8,
  k9: w => w.k9,
  k10: w => w.k10,
  k11: w => w.k11,
  k12: w => w.k12,
  k13: w => w.k13,
  k14: w => w.k14,
  k15: w => w.k15,
  k16: w => w.k16,
  k17: w => w.k17,
  k18: w => w.k18,
  k19: w => w.k19,
};

const names: Key[] = ["k0", "k1", "k2", "k3", "k4", "k5", "k6", "k7", "k8", "k9", "k10", "k11", "k12", "k13", "k14", "k15", "k16", "k17", "k18", "k19"];

function listings(w: Wide): string[] {
  const walked: string[] = [];
  for (const key in w) walked.push(key);
  return [Object.keys(w).join(), walked.join(), Object.keys({ ...w }).join(), Object.keys(JSON.parse(JSON.stringify(w))).join()];
}

function churn(label: string, subject: Wide, start: number, steps: number): void {
  let seed = start;
  const order: Key[] = [];
  const held = new Map<Key, number>();
  let wrong = 0;
  let firstWrong = "";
  for (let step = 0; step < steps; step++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const key = names[(seed >> 4) % names.length];
    const at = order.indexOf(key);
    if ((seed >> 12) % 4 === 0) {
      removers[key](subject);
      held.delete(key);
      if (at >= 0) order.splice(at, 1);
    } else {
      setters[key](subject, step);
      held.set(key, step);
      if (at < 0) order.push(key);
    }
    const expected = order.join();
    for (const got of listings(subject)) {
      if (got !== expected) {
        wrong++;
        if (firstWrong === "") firstWrong = "step " + step + ": " + got + " should be " + expected;
      }
    }
    for (const name of names) {
      if (readers[name](subject) !== held.get(name) || name in subject !== held.has(name)) {
        wrong++;
        if (firstWrong === "") firstWrong = "step " + step + ": " + name + " reads " + readers[name](subject) + " should be " + held.get(name);
      }
    }
  }
  console.log(label + ": " + steps + " steps, " + wrong + " wrong " + firstWrong);
  console.log(label + ", at the end: " + JSON.stringify(subject));
}

churn("a literal", {}, 1, 1500);
churn("a literal that begins with three", { k7: -1, k3: -1, k19: -1 }, 2, 0);
churn("an instance", new Roomy(), 3, 1500);
churn("a second literal", {}, 4, 1500);

const filled: Wide = {};
for (const name of [...names].reverse()) setters[name](filled, 1);
console.log("all twenty, backwards: " + Object.keys(filled).join());
for (const name of names) if (name.length === 2) removers[name](filled);
console.log("the first ten deleted: " + Object.keys(filled).join());
for (const name of names) setters[name](filled, 2);
console.log("all stored again: " + Object.keys(filled).join());

export {};
