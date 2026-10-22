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

function ask1(o: number[]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "number") + " " + typeof o[1];
}

function block1(): void {
  const list: number[] = [1, 2, 3];
  Reflect.deleteProperty(list, 1);
  attempt("an element of numbers is deleted, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "number") + " " + typeof list[1]);
  attempt("an element of numbers is deleted, asked by a typed function", () => ask1(list));
  attempt("an element of numbers is deleted, asked by a callback", () => list.filter(n => n === undefined).length + " " + list.filter(n => typeof n === "number").length);
  attempt("an element of numbers is deleted, used", () => list[1] + 1);
  attempt("an element of numbers is deleted, summed", () => list.reduce((a, b) => a + b, 0));
  attempt("an element of numbers is deleted, listed", () => list.length + " " + Object.keys(list).join() + " " + JSON.stringify(list));
  attempt("an element of numbers is deleted, a typed store", () => (list[1] = 5));
  attempt("an element of numbers is deleted, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "number") + " " + typeof list[1]);
}

block1();

function ask2(o: string[]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "string") + " " + typeof o[1];
}

function block2(): void {
  const list: string[] = ["a", "b", "c"];
  Reflect.deleteProperty(list, 1);
  attempt("an element of strings is deleted, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
  attempt("an element of strings is deleted, asked by a typed function", () => ask2(list));
  attempt("an element of strings is deleted, asked by a callback", () => list.filter(s => s === undefined).length + " " + list.filter(s => typeof s === "string").length);
  attempt("an element of strings is deleted, used", () => list[1].length);
  attempt("an element of strings is deleted, joined", () => list.join("+"));
  attempt("an element of strings is deleted, listed", () => list.length + " " + Object.keys(list).join() + " " + JSON.stringify(list));
  attempt("an element of strings is deleted, a typed store", () => (list[1] = "z"));
  attempt("an element of strings is deleted, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
}

block2();

interface C3 {
  depth3: number;
}

function ask3(o: C3[]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "object") + " " + typeof o[1];
}

function block3(): void {
  const list: C3[] = [{ depth3: 1 }, { depth3: 2 }, { depth3: 3 }];
  Reflect.deleteProperty(list, 1);
  attempt("an element of objects is deleted, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "object") + " " + typeof list[1]);
  attempt("an element of objects is deleted, asked by a typed function", () => ask3(list));
  attempt("an element of objects is deleted, asked by a callback", () => list.filter(part => part === undefined).length + " " + list.filter(part => typeof part === "object").length);
  attempt("an element of objects is deleted, used", () => list[1].depth3);
  attempt("an element of objects is deleted, mapped", () => list.map(part => part.depth3).join());
  attempt("an element of objects is deleted, listed", () => list.length + " " + JSON.stringify(list));
  attempt("an element of objects is deleted, a typed store", () => (list[1] = { depth3: 9 }));
  attempt("an element of objects is deleted, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "object") + " " + typeof list[1]);
}

block3();

function ask4(o: [number, string]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "string") + " " + typeof o[1];
}

function block4(): void {
  const list: [number, string] = [1, "one"];
  Reflect.deleteProperty(list, 1);
  attempt("an element of a tuple is deleted, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
  attempt("an element of a tuple is deleted, asked by a typed function", () => ask4(list));
  attempt("an element of a tuple is deleted, asked by a callback", () => [list].filter(q => q[1] === undefined).length + " " + [list].filter(q => typeof q[1] === "string").length);
  attempt("an element of a tuple is deleted, used", () => list[1].length + list[0]);
  attempt("an element of a tuple is deleted, a pattern", () => (([n, s]: [number, string]) => s + n)(list));
  attempt("an element of a tuple is deleted, listed", () => list.length + " " + JSON.stringify(list));
  attempt("an element of a tuple is deleted, a typed store", () => (list[1] = "two"));
  attempt("an element of a tuple is deleted, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
}

block4();

export {};
