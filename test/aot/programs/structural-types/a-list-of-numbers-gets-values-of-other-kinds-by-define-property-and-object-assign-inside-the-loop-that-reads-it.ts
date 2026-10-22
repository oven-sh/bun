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

attempt("a string is defined, the kind of an element", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { value: "text" });
    if (typeof list[1] === "number") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a string is defined, the sum of three elements", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { value: "text" });
    if (list[0] + list[1] + list[2] === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a string is defined, the length", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { value: "text" });
    if (list.length === 3) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a string is defined, whether an element is there", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { value: "text" });
    if (1 in list) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a string is defined, indexOf", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { value: "text" });
    if (list.indexOf(2) === 1) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a string is defined, includes", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { value: "text" });
    if (list.includes(2)) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a string is defined, at", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { value: "text" });
    if (list.at(1) === 2) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a string is defined, reduce", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { value: "text" });
    if (list.reduce((a, b) => a + b, 0) === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a string is defined, every", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { value: "text" });
    if (list.every(n => typeof n === "number")) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a string is defined, join", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { value: "text" });
    if (list.join() === "1,2,3") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a string is defined, a loop inside the loop", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { value: "text" });
    let total = 0;
    for (const n of list) total += n;
    if (total === 6) held++;
  }
  return held;
});
attempt("a string is defined, a typed store", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Object.defineProperty(list, 1, { value: "text" });
      list[1] = i;
      if (list[1] === i) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error) + " " + list.join();
  }
  return held + " " + list.join();
});
attempt("null is assigned, the kind of an element", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.assign(list, { 1: null });
    if (typeof list[1] === "number") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("null is assigned, the sum of three elements", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.assign(list, { 1: null });
    if (list[0] + list[1] + list[2] === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("null is assigned, the length", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.assign(list, { 1: null });
    if (list.length === 3) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("null is assigned, whether an element is there", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.assign(list, { 1: null });
    if (1 in list) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("null is assigned, indexOf", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.assign(list, { 1: null });
    if (list.indexOf(2) === 1) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("null is assigned, includes", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.assign(list, { 1: null });
    if (list.includes(2)) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("null is assigned, at", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.assign(list, { 1: null });
    if (list.at(1) === 2) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("null is assigned, reduce", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.assign(list, { 1: null });
    if (list.reduce((a, b) => a + b, 0) === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("null is assigned, every", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.assign(list, { 1: null });
    if (list.every(n => typeof n === "number")) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("null is assigned, join", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.assign(list, { 1: null });
    if (list.join() === "1,2,3") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("null is assigned, a loop inside the loop", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.assign(list, { 1: null });
    let total = 0;
    for (const n of list) total += n;
    if (total === 6) held++;
  }
  return held;
});
attempt("null is assigned, a typed store", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Object.assign(list, { 1: null });
      list[1] = i;
      if (list[1] === i) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error) + " " + list.join();
  }
  return held + " " + list.join();
});
attempt("a getter is defined, the kind of an element", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { get: () => 2, enumerable: true, configurable: true });
    if (typeof list[1] === "number") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a getter is defined, the sum of three elements", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { get: () => 2, enumerable: true, configurable: true });
    if (list[0] + list[1] + list[2] === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a getter is defined, the length", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { get: () => 2, enumerable: true, configurable: true });
    if (list.length === 3) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a getter is defined, whether an element is there", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { get: () => 2, enumerable: true, configurable: true });
    if (1 in list) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a getter is defined, indexOf", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { get: () => 2, enumerable: true, configurable: true });
    if (list.indexOf(2) === 1) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a getter is defined, includes", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { get: () => 2, enumerable: true, configurable: true });
    if (list.includes(2)) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a getter is defined, at", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { get: () => 2, enumerable: true, configurable: true });
    if (list.at(1) === 2) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a getter is defined, reduce", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { get: () => 2, enumerable: true, configurable: true });
    if (list.reduce((a, b) => a + b, 0) === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a getter is defined, every", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { get: () => 2, enumerable: true, configurable: true });
    if (list.every(n => typeof n === "number")) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a getter is defined, join", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { get: () => 2, enumerable: true, configurable: true });
    if (list.join() === "1,2,3") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a getter is defined, a loop inside the loop", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, 1, { get: () => 2, enumerable: true, configurable: true });
    let total = 0;
    for (const n of list) total += n;
    if (total === 6) held++;
  }
  return held;
});
attempt("a getter is defined, a typed store", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Object.defineProperty(list, 1, { get: () => 2, enumerable: true, configurable: true });
      list[1] = i;
      if (list[1] === i) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error) + " " + list.join();
  }
  return held + " " + list.join();
});

export {};
