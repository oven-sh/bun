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

attempt("a borrowed fill, the kind of an element", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.fill.call(list, "text", 1, 2);
    if (typeof list[1] === "number") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a borrowed fill, the sum of three elements", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.fill.call(list, "text", 1, 2);
    if (list[0] + list[1] + list[2] === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a borrowed fill, the length", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.fill.call(list, "text", 1, 2);
    if (list.length === 3) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a borrowed fill, whether an element is there", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.fill.call(list, "text", 1, 2);
    if (1 in list) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a borrowed fill, indexOf", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.fill.call(list, "text", 1, 2);
    if (list.indexOf(2) === 1) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a borrowed fill, includes", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.fill.call(list, "text", 1, 2);
    if (list.includes(2)) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a borrowed fill, at", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.fill.call(list, "text", 1, 2);
    if (list.at(1) === 2) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a borrowed fill, reduce", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.fill.call(list, "text", 1, 2);
    if (list.reduce((a, b) => a + b, 0) === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a borrowed fill, every", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.fill.call(list, "text", 1, 2);
    if (list.every(n => typeof n === "number")) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a borrowed fill, join", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.fill.call(list, "text", 1, 2);
    if (list.join() === "1,2,3") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a borrowed fill, a loop inside the loop", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.fill.call(list, "text", 1, 2);
    let total = 0;
    for (const n of list) total += n;
    if (total === 6) held++;
  }
  return held;
});
attempt("a borrowed fill, a typed store", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Array.prototype.fill.call(list, "text", 1, 2);
      list[1] = i;
      if (list[1] === i) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error) + " " + list.join();
  }
  return held + " " + list.join();
});
attempt("a borrowed splice, the kind of an element", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.splice.call(list, 1, 1, "text");
    if (typeof list[1] === "number") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a borrowed splice, the sum of three elements", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.splice.call(list, 1, 1, "text");
    if (list[0] + list[1] + list[2] === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a borrowed splice, the length", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.splice.call(list, 1, 1, "text");
    if (list.length === 3) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a borrowed splice, whether an element is there", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.splice.call(list, 1, 1, "text");
    if (1 in list) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a borrowed splice, indexOf", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.splice.call(list, 1, 1, "text");
    if (list.indexOf(2) === 1) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a borrowed splice, includes", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.splice.call(list, 1, 1, "text");
    if (list.includes(2)) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a borrowed splice, at", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.splice.call(list, 1, 1, "text");
    if (list.at(1) === 2) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a borrowed splice, reduce", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.splice.call(list, 1, 1, "text");
    if (list.reduce((a, b) => a + b, 0) === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a borrowed splice, every", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.splice.call(list, 1, 1, "text");
    if (list.every(n => typeof n === "number")) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a borrowed splice, join", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.splice.call(list, 1, 1, "text");
    if (list.join() === "1,2,3") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a borrowed splice, a loop inside the loop", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.splice.call(list, 1, 1, "text");
    let total = 0;
    for (const n of list) total += n;
    if (total === 6) held++;
  }
  return held;
});
attempt("a borrowed splice, a typed store", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Array.prototype.splice.call(list, 1, 1, "text");
      list[1] = i;
      if (list[1] === i) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error) + " " + list.join();
  }
  return held + " " + list.join();
});
attempt("a borrowed push, the kind of an element", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.push.call(list, "text");
    if (typeof list[1] === "number") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a borrowed push, the sum of three elements", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.push.call(list, "text");
    if (list[0] + list[1] + list[2] === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a borrowed push, the length", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.push.call(list, "text");
    if (list.length === 3) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a borrowed push, whether an element is there", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.push.call(list, "text");
    if (1 in list) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a borrowed push, indexOf", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.push.call(list, "text");
    if (list.indexOf(2) === 1) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a borrowed push, includes", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.push.call(list, "text");
    if (list.includes(2)) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a borrowed push, at", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.push.call(list, "text");
    if (list.at(1) === 2) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a borrowed push, reduce", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.push.call(list, "text");
    if (list.reduce((a, b) => a + b, 0) === 6) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a borrowed push, every", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.push.call(list, "text");
    if (list.every(n => typeof n === "number")) held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a borrowed push, join", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.push.call(list, "text");
    if (list.join() === "1,2,3") held++;
  }
  return held + " " + typeof list[1] + " " + list.length;
});
attempt("a borrowed push, a loop inside the loop", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Array.prototype.push.call(list, "text");
    let total = 0;
    for (const n of list) total += n;
    if (total === 6) held++;
  }
  return held;
});
attempt("a borrowed push, a typed store", () => {
  const list: number[] = [1, 2, 3];
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Array.prototype.push.call(list, "text");
      list[1] = i;
      if (list[1] === i) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error) + " " + list.join();
  }
  return held + " " + list.join();
});

export {};
