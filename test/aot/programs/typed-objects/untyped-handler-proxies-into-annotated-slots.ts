// `new Proxy(target, handler)` is of type `any` where the handler is a `ProxyHandler<any>`. Such a proxy may go wherever a type is written down: what it
// answers is looked at when it is read. Each case has an object type of its own, which the program also makes objects of, so that no case opens the type for another.
function tell(name: string, f: () => unknown): void {
  try {
    console.log(name + ": " + JSON.stringify(f()));
  } catch (e) {
    console.log(name + ": " + String(e).split("\n")[0]);
  }
}

const handler: ProxyHandler<any> = {
  get(target, property) {
    return property === "color" ? "trapped" : property === "inner" ? { n: 7 } : property === "grow" ? () => 8 : Reflect.get(target, property);
  },
};

type InnerOfParameter = { n: number };
type ToParameter = { color: string; inner: InnerOfParameter; grow(): number; parameter?: true };
const makeForParameter = (n: number): ToParameter => ({ color: "red", inner: { n }, grow() { return this.inner.n + 1; } });
const readParameter = (style: ToParameter) => [style.color, style.inner.n, style.grow()];
tell("made by the program, to a parameter", () => readParameter(makeForParameter(1)));
tell("a proxy, to a parameter", () => readParameter(new Proxy({}, handler)));

type InnerOfResult = { n: number };
type AsResult = { color: string; inner: InnerOfResult; grow(): number; result?: true };
const makeForResult = (n: number): AsResult => ({ color: "red", inner: { n }, grow() { return this.inner.n + 1; } });
function proxyAsResult(): AsResult {
  return new Proxy({}, handler);
}
const readResult = (style: AsResult) => [style.color, style.inner.n, style.grow()];
tell("made by the program, returned", () => readResult(makeForResult(1)));
tell("a proxy, returned", () => readResult(proxyAsResult()));

type InnerOfMethod = { n: number };
type FromMethod = { color: string; inner: InnerOfMethod; grow(): number; method?: true };
class Client {
  made(n: number): FromMethod {
    return { color: "red", inner: { n }, grow() { return this.inner.n + 1; } };
  }
  style(selector: string): FromMethod {
    return new Proxy({ selector }, handler);
  }
}
const readMethod = (style: FromMethod) => [style.color, style.inner.n, style.grow()];
tell("made by the program, returned by a method", () => readMethod(new Client().made(1)));
tell("a proxy, returned by a method", () => readMethod(new Client().style("body")));

type InnerOfTarget = { n: number };
type OverTarget = { color: string; inner: InnerOfTarget; grow(): number; target?: true };
const makeTarget = (n: number): OverTarget => ({ color: "red", inner: { n }, grow() { return this.inner.n + 1; } });
const readTarget = (style: OverTarget) => [style.color, style.inner.n, style.grow()];
tell("a proxy over an object of the type", () => readTarget(new Proxy(makeTarget(4), handler)));

type InnerOfChoice = { n: number };
type ByChoice = { color: string; inner: InnerOfChoice; grow(): number; choice?: true };
const makeChoice = (n: number): ByChoice => ({ color: "red", inner: { n }, grow() { return this.inner.n + 1; } });
const readChoice = (style: ByChoice) => [style.color, style.inner.n, style.grow()];
const choose = (proxied: boolean): ByChoice => (proxied ? new Proxy({}, handler) : makeChoice(2));
tell("one arm of a conditional is a proxy", () => [readChoice(choose(true)), readChoice(choose(false))]);
