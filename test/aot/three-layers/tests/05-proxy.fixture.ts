import { check } from "../src/show";
import { Shape, Circle, makePoint, readX, sumXY, setX, callArea, keysOf, hasKey, callWithNew, callTwice } from "fake-shapes";
import { Vec2, total, nameOf, sizeOf } from "fake-typed";
import { Square, makeUser } from "../src/models";
const F = "05";
function traced<T extends object>(target: T, log: string[]): T {
  return new Proxy(target, { get(t, k, r) { log.push("get " + String(k)); return Reflect.get(t, k, r); }, set(t, k, v, r) { log.push("set " + String(k)); return Reflect.set(t, k, v, r); }, has(t, k) { log.push("has " + String(k)); return Reflect.has(t, k); }, ownKeys(t) { log.push("ownKeys"); return Reflect.ownKeys(t); } });
}
check(F, "a proxy of a literal in package code", () => { const log: string[] = []; const p = traced(makePoint(1, 2), log); return [readX(p), sumXY(p), setX(p, 5), hasKey(p, "y"), keysOf(p), log]; });
check(F, "a proxy of a typed instance in typed code", () => { const log: string[] = []; const p = traced(new Vec2(1, 2), log); return [total([p, p]).parts(), p.length, String(p), p instanceof Vec2, log.length]; });
check(F, "a proxy of a user record", () => { const log: string[] = []; const p = traced(makeUser(3), log); return [nameOf(p), sizeOf(p), log]; });
check(F, "a proxy of a class", () => { const log: string[] = []; const P = new Proxy(Square, { construct(t, args, nt) { log.push("construct " + args.length); return Reflect.construct(t, args, nt); } }); const s = new P("p", 3); class Sub extends P {} return [s.area(), s instanceof Square, callWithNew(P, "q", 2).area(), new Sub("sub", 4).describe(), log]; });
check(F, "a proxy of a function", () => { const log: string[] = []; const f = new Proxy(function (this: any, a: number) { return [this?.who, a]; }, { apply(t, self, args) { log.push("apply"); return Reflect.apply(t, self, args); } }); return [callTwice(f as any, 1), log]; });
check(F, "methods with privates refuse proxies", () => { const p = new Proxy(new Circle("c", 1), {}); try { return [callArea(p), p.name, p.id]; } catch (e) { return (e as Error).name; } });
check(F, "revoked", () => { const { proxy, revoke } = Proxy.revocable(makePoint(1, 2), {}); const before = readX(proxy); revoke(); try { return readX(proxy); } catch (e) { return [before, (e as Error).name]; } });
check(F, "Reflect over foreign objects", () => [Reflect.ownKeys(new Square("s", 1)), Reflect.has(new Square("s", 1), "area"), Reflect.get(Circle.prototype, "diameter", { r: 21 }), Reflect.getPrototypeOf(Square) === Shape, Reflect.apply(Shape.prototype.describe, new Square("a", 2), [])]);
