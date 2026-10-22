function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  return error instanceof Error ? "another error" : typeof error;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + show(body()));
  } catch (error) {
    console.log(label + ": threw " + nameOf(error));
  }
}

attempt("read", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list[1];
});
attempt("typeof", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return typeof list[1];
});
attempt("is undefined", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list[1] === undefined;
});
attempt("is a number", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return typeof list[1] === "number";
});
attempt("plus one", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list[1] + 1;
});
attempt("as an integer", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list[1] | 0;
});
attempt("in", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return 1 in list;
});
attempt("length", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.length;
});
attempt("at", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.at(1);
});
attempt("an index loop", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return (() => {
    let total = 0;
    for (let i = 0; i < list.length; i++) total += list[i];
    return total;
  })();
});
attempt("for-of", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return (() => {
    let kinds = "";
    for (const n of list) kinds += typeof n + ",";
    return kinds;
  })();
});
attempt("for-in", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return (() => {
    let keys = "";
    for (const key in list) keys += key + ",";
    return keys;
  })();
});
attempt("forEach", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return (() => {
    let kinds = "";
    list.forEach(n => {
      kinds += typeof n + ",";
    });
    return kinds;
  })();
});
attempt("map to kinds", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.map(n => typeof n).join();
});
attempt("map plus one", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.map(n => n + 1).join();
});
attempt("filter undefined", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.filter(n => n === undefined).length;
});
attempt("filter numbers", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.filter(n => typeof n === "number").length;
});
attempt("find what is no number", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return typeof list.find(n => typeof n !== "number");
});
attempt("findIndex of undefined", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.findIndex(n => n === undefined);
});
attempt("findLast", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.findLast(n => n !== 3);
});
attempt("findLastIndex", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.findLastIndex(n => typeof n !== "number");
});
attempt("some", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.some(n => n == null);
});
attempt("every", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.every(n => typeof n === "number");
});
attempt("reduce", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.reduce((a, b) => a + b, 0);
});
attempt("reduceRight", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.reduceRight((a, b) => a + b, 0);
});
attempt("flatMap", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.flatMap(n => [typeof n]).join();
});
attempt("indexOf", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.indexOf(3);
});
attempt("lastIndexOf", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.lastIndexOf(1);
});
attempt("includes 3", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.includes(3);
});
attempt("includes NaN", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.includes(NaN);
});
attempt("join", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.join();
});
attempt("as text", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return String(list);
});
attempt("json", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return JSON.stringify(list);
});
attempt("keys", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return Object.keys(list).join();
});
attempt("entries", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return [...list.entries()].join("|");
});
attempt("spread", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return [...list].map(n => typeof n).join();
});
attempt("Array.from", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return Array.from(list, n => typeof n).join();
});
attempt("slice", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.slice(1).map(n => typeof n).join() + " " + (0 in list.slice(1));
});
attempt("concat", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return [0].concat(list).map(n => typeof n).join() + " " + (2 in [0].concat(list));
});
attempt("toSorted", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.toSorted().join();
});
attempt("sort", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.sort().join();
});
attempt("toSorted by value", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.toSorted((a, b) => a - b).join();
});
attempt("reverse", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.reverse().join();
});
attempt("toReversed", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.toReversed().join();
});
attempt("with", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.with(0, 9).join();
});
attempt("a default in a pattern", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return (([, b = -1]: number[]) => b)(list);
});
attempt("a rest pattern", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return (([, ...rest]: number[]) => rest.map(n => typeof n).join())(list);
});
attempt("the largest", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return Math.max(...list);
});
attempt("a set", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return new Set(list).size;
});
attempt("floats", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return new Float64Array(list).join();
});
attempt("integers", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return new Int32Array(list).join();
});
attempt("a clone", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return JSON.stringify(structuredClone(list));
});
attempt("push", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.push(4) + " " + list.join();
});
attempt("pop", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.pop();
});
attempt("shift", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.shift() + " " + list.join();
});
attempt("unshift", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.unshift(0) + " " + list.join();
});
attempt("splice", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.splice(1, 1).map(n => typeof n).join() + " " + list.join();
});
attempt("fill", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.fill(8).join();
});
attempt("copyWithin", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.copyWithin(0, 1).join();
});
attempt("flat", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return list.flat().length;
});
attempt("a typed store", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return (list[1] = 5) + " " + list.join();
});
attempt("an increment", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.unshift.call(list, "text");
  return ++list[1];
});

export {};
