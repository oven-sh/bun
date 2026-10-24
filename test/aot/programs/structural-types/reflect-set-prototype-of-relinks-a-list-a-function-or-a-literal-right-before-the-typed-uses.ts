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


function ask9(o: number[]): string {
  return Array.isArray(o) + " " + (o instanceof Array) + " " + (typeof o.push === "function");
}

function block9(): void {
  const list: number[] = [1, 2, 3];
  Reflect.setPrototypeOf(list, null);
  attempt("a list is relinked to null, asked directly", () => Array.isArray(list) + " " + (list instanceof Array) + " " + (typeof list.push === "function"));
  attempt("a list is relinked to null, asked by a typed function", () => ask9(list));
  attempt("a list is relinked to null, asked by a callback", () => [list].filter(q => q instanceof Array).length);
  attempt("a list is relinked to null, an element", () => list[1] + 1);
  attempt("a list is relinked to null, its length", () => list.length);
  attempt("a list is relinked to null, pushed", () => list.push(4));
  attempt("a list is relinked to null, mapped", () => list.map(n => n + 1).join());
  attempt("a list is relinked to null, spread", () => [...list].length);
  attempt("a list is relinked to null, json", () => JSON.stringify(list));
}

block9();


function ask10(o: number[]): string {
  return Array.isArray(o) + " " + (o instanceof Array) + " " + (typeof o.push === "function");
}

function block10(): void {
  const list: number[] = [1, 2, 3];
  Reflect.setPrototypeOf(list, Object.prototype);
  attempt("a list is relinked to Object.prototype, asked directly", () => Array.isArray(list) + " " + (list instanceof Array) + " " + (typeof list.push === "function"));
  attempt("a list is relinked to Object.prototype, asked by a typed function", () => ask10(list));
  attempt("a list is relinked to Object.prototype, asked by a callback", () => [list].filter(q => q instanceof Array).length);
  attempt("a list is relinked to Object.prototype, an element", () => list[1] + 1);
  attempt("a list is relinked to Object.prototype, its length", () => list.length);
  attempt("a list is relinked to Object.prototype, pushed", () => list.push(4));
  attempt("a list is relinked to Object.prototype, mapped", () => list.map(n => n + 1).join());
  attempt("a list is relinked to Object.prototype, spread", () => [...list].length);
  attempt("a list is relinked to Object.prototype, json", () => JSON.stringify(list));
}

block10();


function ask11(o: number[]): string {
  return Array.isArray(o) + " " + (o instanceof Array) + " " + (typeof o.push === "function");
}

function block11(): void {
  const list: number[] = [1, 2, 3];
  Reflect.setPrototypeOf(list, Object.assign(Object.create(Array.prototype), { push: () => -1 }));
  attempt("a list is relinked to an object with another push, asked directly", () => Array.isArray(list) + " " + (list instanceof Array) + " " + (typeof list.push === "function"));
  attempt("a list is relinked to an object with another push, asked by a typed function", () => ask11(list));
  attempt("a list is relinked to an object with another push, asked by a callback", () => [list].filter(q => q instanceof Array).length);
  attempt("a list is relinked to an object with another push, an element", () => list[1] + 1);
  attempt("a list is relinked to an object with another push, its length", () => list.length);
  attempt("a list is relinked to an object with another push, pushed", () => list.push(4));
  attempt("a list is relinked to an object with another push, mapped", () => list.map(n => n + 1).join());
  attempt("a list is relinked to an object with another push, spread", () => [...list].length);
  attempt("a list is relinked to an object with another push, json", () => JSON.stringify(list));
}

block11();


function ask12(o: (n: number) => number): string {
  return (typeof o === "function") + " " + (o instanceof Function) + " " + (typeof o.call === "function");
}

function block12(): void {
  const f = (n: number): number => n * 2;
  Reflect.setPrototypeOf(f, null);
  attempt("a function is relinked to null, asked directly", () => (typeof f === "function") + " " + (f instanceof Function) + " " + (typeof f.call === "function"));
  attempt("a function is relinked to null, asked by a typed function", () => ask12(f));
  attempt("a function is relinked to null, asked by a callback", () => [f].filter(q => q instanceof Function).length);
  attempt("a function is relinked to null, called", () => f(2));
  attempt("a function is relinked to null, through call", () => f.call(undefined, 3));
  attempt("a function is relinked to null, handed to map", () => [1, 2].map(f).join());
}

block12();


function ask13(o: (n: number) => number): string {
  return (typeof o === "function") + " " + (o instanceof Function) + " " + (typeof o.call === "function");
}

function block13(): void {
  const f = (n: number): number => n * 2;
  Reflect.setPrototypeOf(f, Object.prototype);
  attempt("a function is relinked to Object.prototype, asked directly", () => (typeof f === "function") + " " + (f instanceof Function) + " " + (typeof f.call === "function"));
  attempt("a function is relinked to Object.prototype, asked by a typed function", () => ask13(f));
  attempt("a function is relinked to Object.prototype, asked by a callback", () => [f].filter(q => q instanceof Function).length);
  attempt("a function is relinked to Object.prototype, called", () => f(2));
  attempt("a function is relinked to Object.prototype, through call", () => f.call(undefined, 3));
  attempt("a function is relinked to Object.prototype, handed to map", () => [1, 2].map(f).join());
}

block13();

interface C14 {
  id14: number;
  note14?: string;
}

function ask14(o: C14): string {
  return (o.note14 === undefined) + " " + ("note14" in o) + " " + typeof o.note14;
}

function block14(): void {
  const o: C14 = { id14: 1 };
  Reflect.setPrototypeOf(o, { note14: "inherited" });
  attempt("a literal is relinked to an object that has the optional member, asked directly", () => (o.note14 === undefined) + " " + ("note14" in o) + " " + typeof o.note14);
  attempt("a literal is relinked to an object that has the optional member, asked by a typed function", () => ask14(o));
  attempt("a literal is relinked to an object that has the optional member, asked by a callback", () => [o].filter(q => q.note14 === undefined).length);
  attempt("a literal is relinked to an object that has the optional member, or a default", () => o.note14 ?? "default");
  attempt("a literal is relinked to an object that has the optional member, its own member", () => o.id14 + 1);
  attempt("a literal is relinked to an object that has the optional member, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
}

block14();

interface C15 {
  id15: number;
  note15?: string;
}

function ask15(o: C15): string {
  return (o.note15 === undefined) + " " + ("note15" in o) + " " + typeof o.note15;
}

function block15(): void {
  const o: C15 = { id15: 1 };
  Reflect.setPrototypeOf(o, null);
  attempt("a literal is relinked to null, asked directly", () => (o.note15 === undefined) + " " + ("note15" in o) + " " + typeof o.note15);
  attempt("a literal is relinked to null, asked by a typed function", () => ask15(o));
  attempt("a literal is relinked to null, asked by a callback", () => [o].filter(q => q.note15 === undefined).length);
  attempt("a literal is relinked to null, or a default", () => o.note15 ?? "default");
  attempt("a literal is relinked to null, its own member", () => o.id15 + 1);
  attempt("a literal is relinked to null, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
}

block15();

export {};
