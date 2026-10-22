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
  Object.freeze(list);
  attempt("the holder of an element of numbers is frozen, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "number") + " " + typeof list[1]);
  attempt("the holder of an element of numbers is frozen, asked by a typed function", () => ask1(list));
  attempt("the holder of an element of numbers is frozen, asked by a callback", () => list.filter(n => n === undefined).length + " " + list.filter(n => typeof n === "number").length);
  attempt("the holder of an element of numbers is frozen, used", () => list[1] + 1);
  attempt("the holder of an element of numbers is frozen, summed", () => list.reduce((a, b) => a + b, 0));
  attempt("the holder of an element of numbers is frozen, listed", () => list.length + " " + Object.keys(list).join() + " " + JSON.stringify(list));
  attempt("the holder of an element of numbers is frozen, a typed store", () => (list[1] = 5));
  attempt("the holder of an element of numbers is frozen, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "number") + " " + typeof list[1]);
}

block1();

function ask2(o: number[]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "number") + " " + typeof o[1];
}

function block2(): void {
  const list: number[] = [1, 2, 3];
  Object.seal(list);
  attempt("the holder of an element of numbers is sealed, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "number") + " " + typeof list[1]);
  attempt("the holder of an element of numbers is sealed, asked by a typed function", () => ask2(list));
  attempt("the holder of an element of numbers is sealed, asked by a callback", () => list.filter(n => n === undefined).length + " " + list.filter(n => typeof n === "number").length);
  attempt("the holder of an element of numbers is sealed, used", () => list[1] + 1);
  attempt("the holder of an element of numbers is sealed, summed", () => list.reduce((a, b) => a + b, 0));
  attempt("the holder of an element of numbers is sealed, listed", () => list.length + " " + Object.keys(list).join() + " " + JSON.stringify(list));
  attempt("the holder of an element of numbers is sealed, a typed store", () => (list[1] = 5));
  attempt("the holder of an element of numbers is sealed, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "number") + " " + typeof list[1]);
}

block2();

function ask3(o: number[]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "number") + " " + typeof o[1];
}

function block3(): void {
  const list: number[] = [1, 2, 3];
  Reflect.preventExtensions(list);
  attempt("the holder of an element of numbers is kept from growing, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "number") + " " + typeof list[1]);
  attempt("the holder of an element of numbers is kept from growing, asked by a typed function", () => ask3(list));
  attempt("the holder of an element of numbers is kept from growing, asked by a callback", () => list.filter(n => n === undefined).length + " " + list.filter(n => typeof n === "number").length);
  attempt("the holder of an element of numbers is kept from growing, used", () => list[1] + 1);
  attempt("the holder of an element of numbers is kept from growing, summed", () => list.reduce((a, b) => a + b, 0));
  attempt("the holder of an element of numbers is kept from growing, listed", () => list.length + " " + Object.keys(list).join() + " " + JSON.stringify(list));
  attempt("the holder of an element of numbers is kept from growing, a typed store", () => (list[1] = 5));
  attempt("the holder of an element of numbers is kept from growing, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "number") + " " + typeof list[1]);
}

block3();

function ask4(o: number[]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "number") + " " + typeof o[1];
}

function block4(): void {
  const list: number[] = [1, 2, 3];
  Object.defineProperty(list, 1, { writable: false });
  attempt("an element of numbers is made read-only, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "number") + " " + typeof list[1]);
  attempt("an element of numbers is made read-only, asked by a typed function", () => ask4(list));
  attempt("an element of numbers is made read-only, asked by a callback", () => list.filter(n => n === undefined).length + " " + list.filter(n => typeof n === "number").length);
  attempt("an element of numbers is made read-only, used", () => list[1] + 1);
  attempt("an element of numbers is made read-only, summed", () => list.reduce((a, b) => a + b, 0));
  attempt("an element of numbers is made read-only, listed", () => list.length + " " + Object.keys(list).join() + " " + JSON.stringify(list));
  attempt("an element of numbers is made read-only, a typed store", () => (list[1] = 5));
  attempt("an element of numbers is made read-only, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "number") + " " + typeof list[1]);
}

block4();

function ask5(o: string[]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "string") + " " + typeof o[1];
}

function block5(): void {
  const list: string[] = ["a", "b", "c"];
  Object.freeze(list);
  attempt("the holder of an element of strings is frozen, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
  attempt("the holder of an element of strings is frozen, asked by a typed function", () => ask5(list));
  attempt("the holder of an element of strings is frozen, asked by a callback", () => list.filter(s => s === undefined).length + " " + list.filter(s => typeof s === "string").length);
  attempt("the holder of an element of strings is frozen, used", () => list[1].length);
  attempt("the holder of an element of strings is frozen, joined", () => list.join("+"));
  attempt("the holder of an element of strings is frozen, listed", () => list.length + " " + Object.keys(list).join() + " " + JSON.stringify(list));
  attempt("the holder of an element of strings is frozen, a typed store", () => (list[1] = "z"));
  attempt("the holder of an element of strings is frozen, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
}

block5();

function ask6(o: string[]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "string") + " " + typeof o[1];
}

function block6(): void {
  const list: string[] = ["a", "b", "c"];
  Object.seal(list);
  attempt("the holder of an element of strings is sealed, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
  attempt("the holder of an element of strings is sealed, asked by a typed function", () => ask6(list));
  attempt("the holder of an element of strings is sealed, asked by a callback", () => list.filter(s => s === undefined).length + " " + list.filter(s => typeof s === "string").length);
  attempt("the holder of an element of strings is sealed, used", () => list[1].length);
  attempt("the holder of an element of strings is sealed, joined", () => list.join("+"));
  attempt("the holder of an element of strings is sealed, listed", () => list.length + " " + Object.keys(list).join() + " " + JSON.stringify(list));
  attempt("the holder of an element of strings is sealed, a typed store", () => (list[1] = "z"));
  attempt("the holder of an element of strings is sealed, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
}

block6();

function ask7(o: string[]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "string") + " " + typeof o[1];
}

function block7(): void {
  const list: string[] = ["a", "b", "c"];
  Reflect.preventExtensions(list);
  attempt("the holder of an element of strings is kept from growing, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
  attempt("the holder of an element of strings is kept from growing, asked by a typed function", () => ask7(list));
  attempt("the holder of an element of strings is kept from growing, asked by a callback", () => list.filter(s => s === undefined).length + " " + list.filter(s => typeof s === "string").length);
  attempt("the holder of an element of strings is kept from growing, used", () => list[1].length);
  attempt("the holder of an element of strings is kept from growing, joined", () => list.join("+"));
  attempt("the holder of an element of strings is kept from growing, listed", () => list.length + " " + Object.keys(list).join() + " " + JSON.stringify(list));
  attempt("the holder of an element of strings is kept from growing, a typed store", () => (list[1] = "z"));
  attempt("the holder of an element of strings is kept from growing, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
}

block7();

function ask8(o: string[]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "string") + " " + typeof o[1];
}

function block8(): void {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { writable: false });
  attempt("an element of strings is made read-only, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
  attempt("an element of strings is made read-only, asked by a typed function", () => ask8(list));
  attempt("an element of strings is made read-only, asked by a callback", () => list.filter(s => s === undefined).length + " " + list.filter(s => typeof s === "string").length);
  attempt("an element of strings is made read-only, used", () => list[1].length);
  attempt("an element of strings is made read-only, joined", () => list.join("+"));
  attempt("an element of strings is made read-only, listed", () => list.length + " " + Object.keys(list).join() + " " + JSON.stringify(list));
  attempt("an element of strings is made read-only, a typed store", () => (list[1] = "z"));
  attempt("an element of strings is made read-only, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
}

block8();

interface C9 {
  depth9: number;
}

function ask9(o: C9[]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "object") + " " + typeof o[1];
}

function block9(): void {
  const list: C9[] = [{ depth9: 1 }, { depth9: 2 }, { depth9: 3 }];
  Object.freeze(list);
  attempt("the holder of an element of objects is frozen, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "object") + " " + typeof list[1]);
  attempt("the holder of an element of objects is frozen, asked by a typed function", () => ask9(list));
  attempt("the holder of an element of objects is frozen, asked by a callback", () => list.filter(part => part === undefined).length + " " + list.filter(part => typeof part === "object").length);
  attempt("the holder of an element of objects is frozen, used", () => list[1].depth9);
  attempt("the holder of an element of objects is frozen, mapped", () => list.map(part => part.depth9).join());
  attempt("the holder of an element of objects is frozen, listed", () => list.length + " " + JSON.stringify(list));
  attempt("the holder of an element of objects is frozen, a typed store", () => (list[1] = { depth9: 9 }));
  attempt("the holder of an element of objects is frozen, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "object") + " " + typeof list[1]);
}

block9();

interface C10 {
  depth10: number;
}

function ask10(o: C10[]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "object") + " " + typeof o[1];
}

function block10(): void {
  const list: C10[] = [{ depth10: 1 }, { depth10: 2 }, { depth10: 3 }];
  Object.seal(list);
  attempt("the holder of an element of objects is sealed, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "object") + " " + typeof list[1]);
  attempt("the holder of an element of objects is sealed, asked by a typed function", () => ask10(list));
  attempt("the holder of an element of objects is sealed, asked by a callback", () => list.filter(part => part === undefined).length + " " + list.filter(part => typeof part === "object").length);
  attempt("the holder of an element of objects is sealed, used", () => list[1].depth10);
  attempt("the holder of an element of objects is sealed, mapped", () => list.map(part => part.depth10).join());
  attempt("the holder of an element of objects is sealed, listed", () => list.length + " " + JSON.stringify(list));
  attempt("the holder of an element of objects is sealed, a typed store", () => (list[1] = { depth10: 9 }));
  attempt("the holder of an element of objects is sealed, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "object") + " " + typeof list[1]);
}

block10();

interface C11 {
  depth11: number;
}

function ask11(o: C11[]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "object") + " " + typeof o[1];
}

function block11(): void {
  const list: C11[] = [{ depth11: 1 }, { depth11: 2 }, { depth11: 3 }];
  Reflect.preventExtensions(list);
  attempt("the holder of an element of objects is kept from growing, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "object") + " " + typeof list[1]);
  attempt("the holder of an element of objects is kept from growing, asked by a typed function", () => ask11(list));
  attempt("the holder of an element of objects is kept from growing, asked by a callback", () => list.filter(part => part === undefined).length + " " + list.filter(part => typeof part === "object").length);
  attempt("the holder of an element of objects is kept from growing, used", () => list[1].depth11);
  attempt("the holder of an element of objects is kept from growing, mapped", () => list.map(part => part.depth11).join());
  attempt("the holder of an element of objects is kept from growing, listed", () => list.length + " " + JSON.stringify(list));
  attempt("the holder of an element of objects is kept from growing, a typed store", () => (list[1] = { depth11: 9 }));
  attempt("the holder of an element of objects is kept from growing, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "object") + " " + typeof list[1]);
}

block11();

interface C12 {
  depth12: number;
}

function ask12(o: C12[]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "object") + " " + typeof o[1];
}

function block12(): void {
  const list: C12[] = [{ depth12: 1 }, { depth12: 2 }, { depth12: 3 }];
  Object.defineProperty(list, 1, { writable: false });
  attempt("an element of objects is made read-only, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "object") + " " + typeof list[1]);
  attempt("an element of objects is made read-only, asked by a typed function", () => ask12(list));
  attempt("an element of objects is made read-only, asked by a callback", () => list.filter(part => part === undefined).length + " " + list.filter(part => typeof part === "object").length);
  attempt("an element of objects is made read-only, used", () => list[1].depth12);
  attempt("an element of objects is made read-only, mapped", () => list.map(part => part.depth12).join());
  attempt("an element of objects is made read-only, listed", () => list.length + " " + JSON.stringify(list));
  attempt("an element of objects is made read-only, a typed store", () => (list[1] = { depth12: 9 }));
  attempt("an element of objects is made read-only, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "object") + " " + typeof list[1]);
}

block12();

function ask13(o: [number, string]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "string") + " " + typeof o[1];
}

function block13(): void {
  const list: [number, string] = [1, "one"];
  Object.freeze(list);
  attempt("the holder of an element of a tuple is frozen, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
  attempt("the holder of an element of a tuple is frozen, asked by a typed function", () => ask13(list));
  attempt("the holder of an element of a tuple is frozen, asked by a callback", () => [list].filter(q => q[1] === undefined).length + " " + [list].filter(q => typeof q[1] === "string").length);
  attempt("the holder of an element of a tuple is frozen, used", () => list[1].length + list[0]);
  attempt("the holder of an element of a tuple is frozen, a pattern", () => (([n, s]: [number, string]) => s + n)(list));
  attempt("the holder of an element of a tuple is frozen, listed", () => list.length + " " + JSON.stringify(list));
  attempt("the holder of an element of a tuple is frozen, a typed store", () => (list[1] = "two"));
  attempt("the holder of an element of a tuple is frozen, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
}

block13();

function ask14(o: [number, string]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "string") + " " + typeof o[1];
}

function block14(): void {
  const list: [number, string] = [1, "one"];
  Object.seal(list);
  attempt("the holder of an element of a tuple is sealed, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
  attempt("the holder of an element of a tuple is sealed, asked by a typed function", () => ask14(list));
  attempt("the holder of an element of a tuple is sealed, asked by a callback", () => [list].filter(q => q[1] === undefined).length + " " + [list].filter(q => typeof q[1] === "string").length);
  attempt("the holder of an element of a tuple is sealed, used", () => list[1].length + list[0]);
  attempt("the holder of an element of a tuple is sealed, a pattern", () => (([n, s]: [number, string]) => s + n)(list));
  attempt("the holder of an element of a tuple is sealed, listed", () => list.length + " " + JSON.stringify(list));
  attempt("the holder of an element of a tuple is sealed, a typed store", () => (list[1] = "two"));
  attempt("the holder of an element of a tuple is sealed, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
}

block14();

function ask15(o: [number, string]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "string") + " " + typeof o[1];
}

function block15(): void {
  const list: [number, string] = [1, "one"];
  Reflect.preventExtensions(list);
  attempt("the holder of an element of a tuple is kept from growing, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
  attempt("the holder of an element of a tuple is kept from growing, asked by a typed function", () => ask15(list));
  attempt("the holder of an element of a tuple is kept from growing, asked by a callback", () => [list].filter(q => q[1] === undefined).length + " " + [list].filter(q => typeof q[1] === "string").length);
  attempt("the holder of an element of a tuple is kept from growing, used", () => list[1].length + list[0]);
  attempt("the holder of an element of a tuple is kept from growing, a pattern", () => (([n, s]: [number, string]) => s + n)(list));
  attempt("the holder of an element of a tuple is kept from growing, listed", () => list.length + " " + JSON.stringify(list));
  attempt("the holder of an element of a tuple is kept from growing, a typed store", () => (list[1] = "two"));
  attempt("the holder of an element of a tuple is kept from growing, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
}

block15();

function ask16(o: [number, string]): string {
  return (o[1] === undefined) + " " + (o[1] == null) + " " + (typeof o[1] === "string") + " " + typeof o[1];
}

function block16(): void {
  const list: [number, string] = [1, "one"];
  Object.defineProperty(list, 1, { writable: false });
  attempt("an element of a tuple is made read-only, asked directly", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
  attempt("an element of a tuple is made read-only, asked by a typed function", () => ask16(list));
  attempt("an element of a tuple is made read-only, asked by a callback", () => [list].filter(q => q[1] === undefined).length + " " + [list].filter(q => typeof q[1] === "string").length);
  attempt("an element of a tuple is made read-only, used", () => list[1].length + list[0]);
  attempt("an element of a tuple is made read-only, a pattern", () => (([n, s]: [number, string]) => s + n)(list));
  attempt("an element of a tuple is made read-only, listed", () => list.length + " " + JSON.stringify(list));
  attempt("an element of a tuple is made read-only, a typed store", () => (list[1] = "two"));
  attempt("an element of a tuple is made read-only, asked after the store", () => (list[1] === undefined) + " " + (list[1] == null) + " " + (typeof list[1] === "string") + " " + typeof list[1]);
}

block16();

export {};
