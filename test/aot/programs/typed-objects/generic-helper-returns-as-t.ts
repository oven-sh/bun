// A generic helper fills an object key by key and returns it with a single `as T`; the caller stores the result in a typed field.
type WrapMethod = (f: (...args: never[]) => unknown) => (...args: never[]) => unknown;
function seal<T extends object>(x: T): T { return Object.freeze(x); }
function wrapAll<T extends object>(noun: T, wrapMethod: WrapMethod): T {
  const wrapped: Record<string, unknown> = {};
  for (const key of Object.keys(noun)) {
    const member: unknown = (noun as Record<string, unknown>)[key];
    wrapped[key] = typeof member === "function" ? wrapMethod(member as (...args: never[]) => unknown) : member;
  }
  return seal(wrapped) as T;
}
function uiOf(name: string) { return seal({ notice(text: string) { return name + ":" + text; }, size: 3, resolve(n: number) { return n * 2; } }); }
function modelOf() { return seal({ ask(q: string) { return q.length; } }); }
interface Nouns { ui: ReturnType<typeof uiOf>; model: ReturnType<typeof modelOf> }
function nouns(name: string, wrapMethod: WrapMethod): Nouns {
  const wrap = <T extends object>(noun: T): T => wrapAll(noun, wrapMethod);
  return { ui: wrap(uiOf(name)), model: wrap(modelOf()) };
}
let calls = 0;
const n = nouns("p", f => (...a: never[]) => { calls++; return f(...a); });
console.log(n.ui.notice("hi"), n.ui.size, n.ui.resolve(4), n.model.ask("abc"), calls, Object.isFrozen(n.ui), Object.keys(n.ui).join());
