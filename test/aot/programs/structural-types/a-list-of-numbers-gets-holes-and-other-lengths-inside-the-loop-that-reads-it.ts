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

attempt("an element is deleted, the kind of an element", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.deleteProperty(list, 1);
    if (typeof list[1] === "number") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element is deleted, the sum of three elements", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.deleteProperty(list, 1);
    if (list[0] + list[1] + list[2] === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element is deleted, the length", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.deleteProperty(list, 1);
    if (list.length === 3) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element is deleted, whether an element is there", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.deleteProperty(list, 1);
    if (1 in list) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element is deleted, indexOf", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.deleteProperty(list, 1);
    if (list.indexOf(2) === 1) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element is deleted, includes", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.deleteProperty(list, 1);
    if (list.includes(2)) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element is deleted, at", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.deleteProperty(list, 1);
    if (list.at(1) === 2) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element is deleted, reduce", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.deleteProperty(list, 1);
    if (list.reduce((a, b) => a + b, 0) === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element is deleted, every", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.deleteProperty(list, 1);
    if (list.every(n => typeof n === "number")) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element is deleted, join", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.deleteProperty(list, 1);
    if (list.join() === "1,2,3") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element is deleted, a loop inside the loop", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.deleteProperty(list, 1);
    let total = 0;
    for (const n of list) total += n;
    if (total === 6) held++;
  }
  return held;
});
attempt("an element is deleted, a typed store", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Reflect.deleteProperty(list, 1);
      list[1] = i;
      if (list[1] === i) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error) + " " + list.join();
  }
  return held + " " + list.join();
});
attempt("the length is set to five, the kind of an element", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, "length", 5);
    if (typeof list[1] === "number") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the length is set to five, the sum of three elements", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, "length", 5);
    if (list[0] + list[1] + list[2] === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the length is set to five, the length", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, "length", 5);
    if (list.length === 3) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the length is set to five, whether an element is there", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, "length", 5);
    if (1 in list) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the length is set to five, indexOf", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, "length", 5);
    if (list.indexOf(2) === 1) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the length is set to five, includes", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, "length", 5);
    if (list.includes(2)) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the length is set to five, at", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, "length", 5);
    if (list.at(1) === 2) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the length is set to five, reduce", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, "length", 5);
    if (list.reduce((a, b) => a + b, 0) === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the length is set to five, every", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, "length", 5);
    if (list.every(n => typeof n === "number")) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the length is set to five, join", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, "length", 5);
    if (list.join() === "1,2,3") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the length is set to five, a loop inside the loop", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, "length", 5);
    let total = 0;
    for (const n of list) total += n;
    if (total === 6) held++;
  }
  return held;
});
attempt("the length is set to five, a typed store", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Reflect.set(list, "length", 5);
      list[1] = i;
      if (list[1] === i) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error) + " " + list.join();
  }
  return held + " " + list.join();
});
attempt("the length is defined as one, the kind of an element", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, "length", { value: 1 });
    if (typeof list[1] === "number") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the length is defined as one, the sum of three elements", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, "length", { value: 1 });
    if (list[0] + list[1] + list[2] === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the length is defined as one, the length", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, "length", { value: 1 });
    if (list.length === 3) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the length is defined as one, whether an element is there", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, "length", { value: 1 });
    if (1 in list) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the length is defined as one, indexOf", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, "length", { value: 1 });
    if (list.indexOf(2) === 1) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the length is defined as one, includes", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, "length", { value: 1 });
    if (list.includes(2)) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the length is defined as one, at", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, "length", { value: 1 });
    if (list.at(1) === 2) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the length is defined as one, reduce", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, "length", { value: 1 });
    if (list.reduce((a, b) => a + b, 0) === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the length is defined as one, every", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, "length", { value: 1 });
    if (list.every(n => typeof n === "number")) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the length is defined as one, join", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, "length", { value: 1 });
    if (list.join() === "1,2,3") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("the length is defined as one, a loop inside the loop", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(list, "length", { value: 1 });
    let total = 0;
    for (const n of list) total += n;
    if (total === 6) held++;
  }
  return held;
});
attempt("the length is defined as one, a typed store", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Object.defineProperty(list, "length", { value: 1 });
      list[1] = i;
      if (list[1] === i) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error) + " " + list.join();
  }
  return held + " " + list.join();
});
attempt("an element far behind the end, the kind of an element", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 50, 7);
    if (typeof list[1] === "number") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element far behind the end, the sum of three elements", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 50, 7);
    if (list[0] + list[1] + list[2] === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element far behind the end, the length", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 50, 7);
    if (list.length === 3) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element far behind the end, whether an element is there", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 50, 7);
    if (1 in list) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element far behind the end, indexOf", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 50, 7);
    if (list.indexOf(2) === 1) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element far behind the end, includes", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 50, 7);
    if (list.includes(2)) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element far behind the end, at", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 50, 7);
    if (list.at(1) === 2) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element far behind the end, reduce", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 50, 7);
    if (list.reduce((a, b) => a + b, 0) === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element far behind the end, every", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 50, 7);
    if (list.every(n => typeof n === "number")) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element far behind the end, join", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 50, 7);
    if (list.join() === "1,2,3") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("an element far behind the end, a loop inside the loop", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(list, 50, 7);
    let total = 0;
    for (const n of list) total += n;
    if (total === 6) held++;
  }
  return held;
});
attempt("an element far behind the end, a typed store", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Reflect.set(list, 50, 7);
      list[1] = i;
      if (list[1] === i) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error) + " " + list.join();
  }
  return held + " " + list.join();
});

export {};
