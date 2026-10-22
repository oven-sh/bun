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

class C1 {
  value = 1;
}

attempt("a number field, used", () => {
  const o = new C1();
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Object.assign(o, { value: undefined });
      if (o.value + 1 === 2) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error);
  }
  return held;
});
attempt("a number field, asked for its kind", () => {
  const o = new C1();
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Object.assign(o, { value: undefined });
      if (typeof o.value === "number") held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error);
  }
  return held;
});

class C2 {
  value = "s";
}

attempt("a string field, used", () => {
  const o = new C2();
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Object.assign(o, { value: undefined });
      if (o.value.length === 1) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error);
  }
  return held;
});
attempt("a string field, asked for its kind", () => {
  const o = new C2();
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Object.assign(o, { value: undefined });
      if (typeof o.value === "string") held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error);
  }
  return held;
});

class C3 {
  value = { depth: 1 };
}

attempt("an object field, used", () => {
  const o = new C3();
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Object.assign(o, { value: undefined });
      if (o.value.depth === 1) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error);
  }
  return held;
});
attempt("an object field, asked for its kind", () => {
  const o = new C3();
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Object.assign(o, { value: undefined });
      if (typeof o.value === "object") held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error);
  }
  return held;
});

class C4 {
  value: () => number = () => 1;
}

attempt("a function field, used", () => {
  const o = new C4();
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Object.assign(o, { value: undefined });
      if (o.value() === 1) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error);
  }
  return held;
});
attempt("a function field, asked for its kind", () => {
  const o = new C4();
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Object.assign(o, { value: undefined });
      if (typeof o.value === "function") held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error);
  }
  return held;
});

interface C5 {
  value5: number;
}

attempt("a member of a literal, used", () => {
  const o: C5 = { value5: 1 };
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Object.assign(o, { value5: undefined });
      if (o.value5 + 1 === 2) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error);
  }
  return held;
});
attempt("a member of a literal, asked for its kind", () => {
  const o: C5 = { value5: 1 };
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Object.assign(o, { value5: undefined });
      if (typeof o.value5 === "number") held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error);
  }
  return held;
});

class C6 {
  value(): number {
    return 1;
  }
}

attempt("a method of a prototype, used", () => {
  const o = new C6();
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Object.assign(C6.prototype, { value: undefined });
      if (o.value() === 1) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error);
  }
  return held;
});

class C7 {
  static value = 1;
}

attempt("a static field, used", () => {
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Object.assign(C7, { value: undefined });
      if (C7.value + 1 === 2) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error);
  }
  return held;
});

class C8 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

attempt("a field read by a method, used", () => {
  const o = new C8();
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Object.assign(o, { value: undefined });
      if (o.twice() === 2) held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error);
  }
  return held;
});
attempt("a field read by a method, asked for its kind", () => {
  const o = new C8();
  let held = 0;
  try {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) Object.assign(o, { value: undefined });
      if (typeof o.twice() === "number") held++;
    }
  } catch (error) {
    return held + " threw " + nameOf(error);
  }
  return held;
});

export {};
