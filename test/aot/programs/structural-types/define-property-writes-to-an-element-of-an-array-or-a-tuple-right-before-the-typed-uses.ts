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
  Object.defineProperty(list, 1, { value: undefined });
  attempt("an element of numbers becomes undefined, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "number") + " " + typeof list[1]);
  attempt("an element of numbers becomes undefined, asked by a typed function", () => ask1(list));
  attempt("an element of numbers becomes undefined, asked by a callback", () => list.filter(n => n === undefined).length + " " + list.filter(n => typeof n === "number").length);
  attempt("an element of numbers becomes undefined, used", () => list[1] + 1);
  attempt("an element of numbers becomes undefined, summed", () => list.reduce((a, b) => a + b, 0));
  attempt("an element of numbers becomes undefined, listed", () => list.length + " " + Object.keys(list).join() + " " + JSON.stringify(list));
  attempt("an element of numbers becomes undefined, a typed store", () => (list[1] = 5));
  attempt("an element of numbers becomes undefined, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "number") + " " + typeof list[1]);
}

block1();

function ask2(o: number[]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "number") + " " + typeof o[1];
}

function block2(): void {
  const list: number[] = [1, 2, 3];
  Object.defineProperty(list, 1, { value: "text" });
  attempt("an element of numbers becomes a value of another kind, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "number") + " " + typeof list[1]);
  attempt("an element of numbers becomes a value of another kind, asked by a typed function", () => ask2(list));
  attempt("an element of numbers becomes a value of another kind, asked by a callback", () => list.filter(n => n === undefined).length + " " + list.filter(n => typeof n === "number").length);
  attempt("an element of numbers becomes a value of another kind, used", () => list[1] + 1);
  attempt("an element of numbers becomes a value of another kind, summed", () => list.reduce((a, b) => a + b, 0));
  attempt("an element of numbers becomes a value of another kind, listed", () => list.length + " " + Object.keys(list).join() + " " + JSON.stringify(list));
  attempt("an element of numbers becomes a value of another kind, a typed store", () => (list[1] = 5));
  attempt("an element of numbers becomes a value of another kind, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "number") + " " + typeof list[1]);
}

block2();

function ask3(o: string[]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "string") + " " + typeof o[1];
}

function block3(): void {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: undefined });
  attempt("an element of strings becomes undefined, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
  attempt("an element of strings becomes undefined, asked by a typed function", () => ask3(list));
  attempt("an element of strings becomes undefined, asked by a callback", () => list.filter(s => s === undefined).length + " " + list.filter(s => typeof s === "string").length);
  attempt("an element of strings becomes undefined, used", () => list[1].length);
  attempt("an element of strings becomes undefined, joined", () => list.join("+"));
  attempt("an element of strings becomes undefined, listed", () => list.length + " " + Object.keys(list).join() + " " + JSON.stringify(list));
  attempt("an element of strings becomes undefined, a typed store", () => (list[1] = "z"));
  attempt("an element of strings becomes undefined, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
}

block3();

function ask4(o: string[]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "string") + " " + typeof o[1];
}

function block4(): void {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: 7 });
  attempt("an element of strings becomes a value of another kind, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
  attempt("an element of strings becomes a value of another kind, asked by a typed function", () => ask4(list));
  attempt("an element of strings becomes a value of another kind, asked by a callback", () => list.filter(s => s === undefined).length + " " + list.filter(s => typeof s === "string").length);
  attempt("an element of strings becomes a value of another kind, used", () => list[1].length);
  attempt("an element of strings becomes a value of another kind, joined", () => list.join("+"));
  attempt("an element of strings becomes a value of another kind, listed", () => list.length + " " + Object.keys(list).join() + " " + JSON.stringify(list));
  attempt("an element of strings becomes a value of another kind, a typed store", () => (list[1] = "z"));
  attempt("an element of strings becomes a value of another kind, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
}

block4();

interface C5 {
  depth5: number;
}

function ask5(o: C5[]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "object") + " " + typeof o[1];
}

function block5(): void {
  const list: C5[] = [{ depth5: 1 }, { depth5: 2 }, { depth5: 3 }];
  Object.defineProperty(list, 1, { value: undefined });
  attempt("an element of objects becomes undefined, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "object") + " " + typeof list[1]);
  attempt("an element of objects becomes undefined, asked by a typed function", () => ask5(list));
  attempt("an element of objects becomes undefined, asked by a callback", () => list.filter(part => part === undefined).length + " " + list.filter(part => typeof part === "object").length);
  attempt("an element of objects becomes undefined, used", () => list[1].depth5);
  attempt("an element of objects becomes undefined, mapped", () => list.map(part => part.depth5).join());
  attempt("an element of objects becomes undefined, listed", () => list.length + " " + JSON.stringify(list));
  attempt("an element of objects becomes undefined, a typed store", () => (list[1] = { depth5: 9 }));
  attempt("an element of objects becomes undefined, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "object") + " " + typeof list[1]);
}

block5();

interface C6 {
  depth6: number;
}

function ask6(o: C6[]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "object") + " " + typeof o[1];
}

function block6(): void {
  const list: C6[] = [{ depth6: 1 }, { depth6: 2 }, { depth6: 3 }];
  Object.defineProperty(list, 1, { value: 5 });
  attempt("an element of objects becomes a value of another kind, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "object") + " " + typeof list[1]);
  attempt("an element of objects becomes a value of another kind, asked by a typed function", () => ask6(list));
  attempt("an element of objects becomes a value of another kind, asked by a callback", () => list.filter(part => part === undefined).length + " " + list.filter(part => typeof part === "object").length);
  attempt("an element of objects becomes a value of another kind, used", () => list[1].depth6);
  attempt("an element of objects becomes a value of another kind, mapped", () => list.map(part => part.depth6).join());
  attempt("an element of objects becomes a value of another kind, listed", () => list.length + " " + JSON.stringify(list));
  attempt("an element of objects becomes a value of another kind, a typed store", () => (list[1] = { depth6: 9 }));
  attempt("an element of objects becomes a value of another kind, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "object") + " " + typeof list[1]);
}

block6();

function ask7(o: [number, string]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "string") + " " + typeof o[1];
}

function block7(): void {
  const list: [number, string] = [1, "one"];
  Object.defineProperty(list, 1, { value: undefined });
  attempt("an element of a tuple becomes undefined, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
  attempt("an element of a tuple becomes undefined, asked by a typed function", () => ask7(list));
  attempt("an element of a tuple becomes undefined, asked by a callback", () => [list].filter(q => q[1] === undefined).length + " " + [list].filter(q => typeof q[1] === "string").length);
  attempt("an element of a tuple becomes undefined, used", () => list[1].length + list[0]);
  attempt("an element of a tuple becomes undefined, a pattern", () => (([n, s]: [number, string]) => s + n)(list));
  attempt("an element of a tuple becomes undefined, listed", () => list.length + " " + JSON.stringify(list));
  attempt("an element of a tuple becomes undefined, a typed store", () => (list[1] = "two"));
  attempt("an element of a tuple becomes undefined, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
}

block7();

function ask8(o: [number, string]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "string") + " " + typeof o[1];
}

function block8(): void {
  const list: [number, string] = [1, "one"];
  Object.defineProperty(list, 1, { value: 7 });
  attempt("an element of a tuple becomes a value of another kind, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
  attempt("an element of a tuple becomes a value of another kind, asked by a typed function", () => ask8(list));
  attempt("an element of a tuple becomes a value of another kind, asked by a callback", () => [list].filter(q => q[1] === undefined).length + " " + [list].filter(q => typeof q[1] === "string").length);
  attempt("an element of a tuple becomes a value of another kind, used", () => list[1].length + list[0]);
  attempt("an element of a tuple becomes a value of another kind, a pattern", () => (([n, s]: [number, string]) => s + n)(list));
  attempt("an element of a tuple becomes a value of another kind, listed", () => list.length + " " + JSON.stringify(list));
  attempt("an element of a tuple becomes a value of another kind, a typed store", () => (list[1] = "two"));
  attempt("an element of a tuple becomes a value of another kind, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
}

block8();

export {};
