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

attempt("a string, the kind of an element", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, "text");
    if (typeof list[1] === "number") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a string, the sum of three elements", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, "text");
    if (list[0] + list[1] + list[2] === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a string, the length", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, "text");
    if (list.length === 3) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a string, whether an element is there", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, "text");
    if (1 in list) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a string, indexOf", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, "text");
    if (list.indexOf(2) === 1) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a string, includes", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, "text");
    if (list.includes(2)) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a string, at", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, "text");
    if (list.at(1) === 2) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a string, reduce", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, "text");
    if (list.reduce((a, b) => a + b, 0) === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a string, every", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, "text");
    if (list.every(n => typeof n === "number")) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a string, join", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, "text");
    if (list.join() === "1,2,3") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a string, a loop inside the loop", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, "text");
    let total = 0;
    for (const n of list) total += n;
    if (total === 6) held++;
  }
  return held;
});
attempt("a string, a typed store", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Reflect.set(list, 1, "text");
      list[1] = i;
      if (list[1] === i) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error) + " " + list.join();
  }
  return held + " " + list.join();
});
attempt("undefined, the kind of an element", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, undefined);
    if (typeof list[1] === "number") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("undefined, the sum of three elements", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, undefined);
    if (list[0] + list[1] + list[2] === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("undefined, the length", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, undefined);
    if (list.length === 3) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("undefined, whether an element is there", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, undefined);
    if (1 in list) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("undefined, indexOf", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, undefined);
    if (list.indexOf(2) === 1) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("undefined, includes", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, undefined);
    if (list.includes(2)) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("undefined, at", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, undefined);
    if (list.at(1) === 2) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("undefined, reduce", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, undefined);
    if (list.reduce((a, b) => a + b, 0) === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("undefined, every", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, undefined);
    if (list.every(n => typeof n === "number")) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("undefined, join", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, undefined);
    if (list.join() === "1,2,3") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("undefined, a loop inside the loop", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, undefined);
    let total = 0;
    for (const n of list) total += n;
    if (total === 6) held++;
  }
  return held;
});
attempt("undefined, a typed store", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Reflect.set(list, 1, undefined);
      list[1] = i;
      if (list[1] === i) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error) + " " + list.join();
  }
  return held + " " + list.join();
});
attempt("a fraction, the kind of an element", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, 2.5);
    if (typeof list[1] === "number") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a fraction, the sum of three elements", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, 2.5);
    if (list[0] + list[1] + list[2] === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a fraction, the length", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, 2.5);
    if (list.length === 3) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a fraction, whether an element is there", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, 2.5);
    if (1 in list) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a fraction, indexOf", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, 2.5);
    if (list.indexOf(2) === 1) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a fraction, includes", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, 2.5);
    if (list.includes(2)) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a fraction, at", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, 2.5);
    if (list.at(1) === 2) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a fraction, reduce", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, 2.5);
    if (list.reduce((a, b) => a + b, 0) === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a fraction, every", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, 2.5);
    if (list.every(n => typeof n === "number")) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a fraction, join", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, 2.5);
    if (list.join() === "1,2,3") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a fraction, a loop inside the loop", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 1, 2.5);
    let total = 0;
    for (const n of list) total += n;
    if (total === 6) held++;
  }
  return held;
});
attempt("a fraction, a typed store", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Reflect.set(list, 1, 2.5);
      list[1] = i;
      if (list[1] === i) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error) + " " + list.join();
  }
  return held + " " + list.join();
});

export {};
