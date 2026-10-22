// What a generator yields is tested against the element type written in its result type (`Generator<T>`, `Iterable<T>`, `AsyncGenerator<T>`). What it returns is not tested, and neither is anything in a generator whose result type is inferred.
const text: any = "text";
function* yields(v: any): Generator<number> { yield 1; yield v; }
function* yieldsIterable(v: any): Iterable<number> { yield v; }
function* returns(v: any): Generator<number, number> { yield 1; return v; }
function* inferred(v: any) { yield 1; yield v; }
async function* yieldsLater(v: any): AsyncGenerator<number> { yield v; }
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", (e as Error).constructor.name); }
}
function drain(iterable: Iterable<unknown>): string {
  const seen: unknown[] = [];
  try { for (const value of iterable) seen.push(value); } catch (e) { seen.push((e as Error).constructor.name); }
  return seen.join();
}

attempt("Generator<number> yields a number", () => drain(yields(2)));
attempt("Generator<number> yields a string", () => drain(yields(text)));
attempt("Generator<number> yields undefined", () => drain(yields(undefined)));
attempt("Iterable<number> yields a string", () => drain(yieldsIterable(text)));
attempt("Generator<number, number> returns a string", () => { const g = returns(text); g.next(); return g.next().value; });
attempt("an inferred result type, a string", () => drain(inferred(text)));
console.log("AsyncGenerator<number> yields a string:", await yieldsLater(text).next().then(step => String(step.value), e => (e as Error).constructor.name));
console.log("AsyncGenerator<number> yields a number:", await yieldsLater(3).next().then(step => String(step.value), e => (e as Error).constructor.name));
export {};
