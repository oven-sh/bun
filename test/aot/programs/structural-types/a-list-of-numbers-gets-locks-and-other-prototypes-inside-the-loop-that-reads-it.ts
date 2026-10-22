function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + nameOf(error));
  }
}

attempt("frozen, the kind of an element", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.freeze(list);
    if (typeof list[1] === "number") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("frozen, the sum of three elements", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.freeze(list);
    if (list[0] + list[1] + list[2] === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("frozen, the length", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.freeze(list);
    if (list.length === 3) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("frozen, whether an element is there", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.freeze(list);
    if (1 in list) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("frozen, indexOf", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.freeze(list);
    if (list.indexOf(2) === 1) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("frozen, includes", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.freeze(list);
    if (list.includes(2)) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("frozen, at", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.freeze(list);
    if (list.at(1) === 2) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("frozen, reduce", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.freeze(list);
    if (list.reduce((a, b) => a + b, 0) === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("frozen, every", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.freeze(list);
    if (list.every(n => typeof n === "number")) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("frozen, join", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.freeze(list);
    if (list.join() === "1,2,3") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("frozen, a loop inside the loop", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.freeze(list);
    let total = 0;
    for (const n of list) total += n;
    if (total === 6) held++;
  }
  return held;
});
attempt("frozen, a typed store", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Object.freeze(list);
      list[1] = i;
      if (list[1] === i) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error) + " " + list.join();
  }
  return held + " " + list.join();
});
attempt("sealed, the kind of an element", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.seal(list);
    if (typeof list[1] === "number") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("sealed, the sum of three elements", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.seal(list);
    if (list[0] + list[1] + list[2] === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("sealed, the length", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.seal(list);
    if (list.length === 3) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("sealed, whether an element is there", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.seal(list);
    if (1 in list) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("sealed, indexOf", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.seal(list);
    if (list.indexOf(2) === 1) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("sealed, includes", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.seal(list);
    if (list.includes(2)) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("sealed, at", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.seal(list);
    if (list.at(1) === 2) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("sealed, reduce", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.seal(list);
    if (list.reduce((a, b) => a + b, 0) === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("sealed, every", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.seal(list);
    if (list.every(n => typeof n === "number")) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("sealed, join", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.seal(list);
    if (list.join() === "1,2,3") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("sealed, a loop inside the loop", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.seal(list);
    let total = 0;
    for (const n of list) total += n;
    if (total === 6) held++;
  }
  return held;
});
attempt("sealed, a typed store", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Object.seal(list);
      list[1] = i;
      if (list[1] === i) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error) + " " + list.join();
  }
  return held + " " + list.join();
});
attempt("an element is made read-only, the kind of an element", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { writable: false });
    if (typeof list[1] === "number") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element is made read-only, the sum of three elements", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { writable: false });
    if (list[0] + list[1] + list[2] === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element is made read-only, the length", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { writable: false });
    if (list.length === 3) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element is made read-only, whether an element is there", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { writable: false });
    if (1 in list) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element is made read-only, indexOf", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { writable: false });
    if (list.indexOf(2) === 1) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element is made read-only, includes", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { writable: false });
    if (list.includes(2)) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element is made read-only, at", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { writable: false });
    if (list.at(1) === 2) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element is made read-only, reduce", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { writable: false });
    if (list.reduce((a, b) => a + b, 0) === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element is made read-only, every", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { writable: false });
    if (list.every(n => typeof n === "number")) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element is made read-only, join", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { writable: false });
    if (list.join() === "1,2,3") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element is made read-only, a loop inside the loop", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { writable: false });
    let total = 0;
    for (const n of list) total += n;
    if (total === 6) held++;
  }
  return held;
});
attempt("an element is made read-only, a typed store", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Object.defineProperty(list, 1, { writable: false });
      list[1] = i;
      if (list[1] === i) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error) + " " + list.join();
  }
  return held + " " + list.join();
});
attempt("the prototype becomes null, the kind of an element", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.setPrototypeOf(list, null);
    if (typeof list[1] === "number") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the prototype becomes null, the sum of three elements", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.setPrototypeOf(list, null);
    if (list[0] + list[1] + list[2] === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the prototype becomes null, the length", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.setPrototypeOf(list, null);
    if (list.length === 3) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the prototype becomes null, whether an element is there", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.setPrototypeOf(list, null);
    if (1 in list) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the prototype becomes null, indexOf", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.setPrototypeOf(list, null);
    if (list.indexOf(2) === 1) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the prototype becomes null, includes", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.setPrototypeOf(list, null);
    if (list.includes(2)) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the prototype becomes null, at", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.setPrototypeOf(list, null);
    if (list.at(1) === 2) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the prototype becomes null, reduce", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.setPrototypeOf(list, null);
    if (list.reduce((a, b) => a + b, 0) === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the prototype becomes null, every", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.setPrototypeOf(list, null);
    if (list.every(n => typeof n === "number")) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the prototype becomes null, join", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.setPrototypeOf(list, null);
    if (list.join() === "1,2,3") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the prototype becomes null, a loop inside the loop", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.setPrototypeOf(list, null);
    let total = 0;
    for (const n of list) total += n;
    if (total === 6) held++;
  }
  return held;
});
attempt("the prototype becomes null, a typed store", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Object.setPrototypeOf(list, null);
      list[1] = i;
      if (list[1] === i) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error) + " " + list.join();
  }
  return held + " " + list.join();
});
attempt("the prototype gets another indexOf, the kind of an element", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.setPrototypeOf(list, Object.assign(Object.create(Array.prototype), { indexOf: () => -5 }));
    if (typeof list[1] === "number") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the prototype gets another indexOf, the sum of three elements", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.setPrototypeOf(list, Object.assign(Object.create(Array.prototype), { indexOf: () => -5 }));
    if (list[0] + list[1] + list[2] === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the prototype gets another indexOf, the length", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.setPrototypeOf(list, Object.assign(Object.create(Array.prototype), { indexOf: () => -5 }));
    if (list.length === 3) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the prototype gets another indexOf, whether an element is there", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.setPrototypeOf(list, Object.assign(Object.create(Array.prototype), { indexOf: () => -5 }));
    if (1 in list) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the prototype gets another indexOf, indexOf", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.setPrototypeOf(list, Object.assign(Object.create(Array.prototype), { indexOf: () => -5 }));
    if (list.indexOf(2) === 1) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the prototype gets another indexOf, includes", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.setPrototypeOf(list, Object.assign(Object.create(Array.prototype), { indexOf: () => -5 }));
    if (list.includes(2)) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the prototype gets another indexOf, at", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.setPrototypeOf(list, Object.assign(Object.create(Array.prototype), { indexOf: () => -5 }));
    if (list.at(1) === 2) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the prototype gets another indexOf, reduce", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.setPrototypeOf(list, Object.assign(Object.create(Array.prototype), { indexOf: () => -5 }));
    if (list.reduce((a, b) => a + b, 0) === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the prototype gets another indexOf, every", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.setPrototypeOf(list, Object.assign(Object.create(Array.prototype), { indexOf: () => -5 }));
    if (list.every(n => typeof n === "number")) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the prototype gets another indexOf, join", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.setPrototypeOf(list, Object.assign(Object.create(Array.prototype), { indexOf: () => -5 }));
    if (list.join() === "1,2,3") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the prototype gets another indexOf, a loop inside the loop", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.setPrototypeOf(list, Object.assign(Object.create(Array.prototype), { indexOf: () => -5 }));
    let total = 0;
    for (const n of list) total += n;
    if (total === 6) held++;
  }
  return held;
});
attempt("the prototype gets another indexOf, a typed store", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Object.setPrototypeOf(list, Object.assign(Object.create(Array.prototype), { indexOf: () => -5 }));
      list[1] = i;
      if (list[1] === i) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error) + " " + list.join();
  }
  return held + " " + list.join();
});

export {};
