function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

function sum(view: Float64Array, between: (i: number) => void): unknown[] {
  let total = 0;
  let rounds = 0;
  for (let i = 0; i < view.length; i++) {
    rounds++;
    total += view[i];
    between(i);
  }
  return [rounds, total, view.length];
}

function sumWithACachedBound(view: Float64Array, between: (i: number) => void): unknown[] {
  let total = 0;
  const kinds: string[] = [];
  for (let i = 0, n = view.length; i < n; i++) {
    between(i);
    kinds.push(typeof view[i]);
    total += view[i];
  }
  return [total, kinds.join(), view.length];
}

function storeWithACachedBound(view: Int32Array, between: (i: number) => void): unknown[] {
  for (let i = 0, n = view.length; i < n; i++) {
    between(i);
    view[i] = i + 1;
  }
  return [view.length, view.length === 0 ? "nothing left" : Array.from(view), typeof view[3]];
}

function tracking(): { buffer: ArrayBuffer; view: Float64Array } {
  const buffer = new ArrayBuffer(32, { maxByteLength: 64 });
  const view = new Float64Array(buffer);
  view.set([1, 2, 3, 4]);
  return { buffer, view };
}

let total = 0;
for (let i = 0; i < 2000; i++) total += Number(sum(new Float64Array([i, 1]), () => {})[1]) + Number(sumWithACachedBound(new Float64Array([i]), () => {})[0]);
console.log("2000 honest rounds: " + total);

attempt("nothing happens", () => {
  const { view } = tracking();
  return [sum(view, () => {}), sumWithACachedBound(view, () => {})];
});
attempt("the buffer is made smaller in the body", () => {
  const { buffer, view } = tracking();
  return sum(view, i => {
    if (i === 0) buffer.resize(16);
  });
});
attempt("the buffer is made smaller, the bound was read once", () => {
  const { buffer, view } = tracking();
  return sumWithACachedBound(view, i => {
    if (i === 1) buffer.resize(8);
  });
});
attempt("the buffer is made larger in the body", () => {
  const { buffer, view } = tracking();
  return sum(view, i => {
    if (i === 0) buffer.resize(48);
  });
});
attempt("the buffer is made empty", () => {
  const { buffer, view } = tracking();
  return sumWithACachedBound(view, i => {
    if (i === 2) buffer.resize(0);
  });
});
attempt("made smaller and larger again: zeros come back", () => {
  const { buffer, view } = tracking();
  buffer.resize(8);
  buffer.resize(32);
  return Array.from(view);
});
attempt("a view of a fixed length goes out of bounds", () => {
  const buffer = new ArrayBuffer(32, { maxByteLength: 64 });
  const view = new Float64Array(buffer, 0, 4);
  view.set([1, 2, 3, 4]);
  buffer.resize(16);
  const during = [view.length, typeof view[0], view.byteLength, view.byteOffset];
  buffer.resize(32);
  return [during, view.length, Array.from(view)];
});
attempt("the buffer is transferred away in the body", () => {
  const view = new Float64Array([1, 2, 3, 4]);
  return sum(view, i => {
    if (i === 1) view.buffer.transfer();
  });
});
attempt("the buffer is transferred away, the bound was read once", () => {
  const view = new Float64Array([1, 2, 3, 4]);
  return sumWithACachedBound(view, i => {
    if (i === 2) view.buffer.transfer();
  });
});
attempt("the buffer is cloned away", () => {
  const view = new Float64Array([1, 2]);
  structuredClone(view.buffer, { transfer: [view.buffer] });
  return [view.length, typeof view[0], view[0] + 1, view.byteLength, view.buffer.byteLength];
});
attempt("stores after the buffer is made smaller", () => {
  const buffer = new ArrayBuffer(16, { maxByteLength: 16 });
  return storeWithACachedBound(new Int32Array(buffer), i => {
    if (i === 2) buffer.resize(8);
  });
});
attempt("stores after the buffer is transferred away", () => {
  const view = new Int32Array(4);
  return storeWithACachedBound(view, i => {
    if (i === 2) view.buffer.transfer();
  });
});
attempt("built-in loops over a detached view", () => {
  const view = new Float64Array([1, 2]);
  view.buffer.transfer();
  return view.map(n => n + 1).length;
});
attempt("for of while the buffer is made smaller", () => {
  const { buffer, view } = tracking();
  const seen: number[] = [];
  for (const n of view) {
    seen.push(n);
    if (n === 2) buffer.resize(16);
  }
  return seen;
});

export {};
