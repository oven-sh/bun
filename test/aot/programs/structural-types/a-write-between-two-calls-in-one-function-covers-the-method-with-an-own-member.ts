interface Target {
  norm(): number;
}

function spare(): Target {
  return { norm: () => 0 };
}

const replacement = (): number => -1;
const key: "norm" = ["no", "rm"].join("") === "norm" ? "norm" : "norm";

function drive<T extends Target>(label: string, p: T, holder: Target, run: (p: T, really: boolean) => string): void {
  let warm = 0;
  for (let i = 0; i < 2000; i++) warm += run(p, false).length;
  const written = Object.getOwnPropertyDescriptor(holder, "norm");
  const parts = [String(warm), run(p, false), run(p, true), run(p, false)];
  if (written) Object.defineProperty(holder, "norm", written);
  else Reflect.deleteProperty(holder, "norm");
  parts.push(run(p, false));
  console.log(label + ": " + parts.join(" | "));
}

class ByStore {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function byStore(p: ByStore, really: boolean): string {
  const before = p.norm();
  const target: Target = really ? p : spare();
  target.norm = replacement;
  return before + " " + p.norm();
}

{
  const p = new ByStore();
  drive("a plain store", p, p, byStore);
}

class ByAssign {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function byAssign(p: ByAssign, really: boolean): string {
  const before = p.norm();
  const target: Target = really ? p : spare();
  Object.assign(target, { norm: replacement });
  return before + " " + p.norm();
}

{
  const p = new ByAssign();
  drive("Object.assign", p, p, byAssign);
}

class ByDefine {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function byDefine(p: ByDefine, really: boolean): string {
  const before = p.norm();
  const target: Target = really ? p : spare();
  Object.defineProperty(target, "norm", { value: replacement, writable: true, configurable: true });
  return before + " " + p.norm();
}

{
  const p = new ByDefine();
  drive("Object.defineProperty", p, p, byDefine);
}

class ByDefineSeveral {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function byDefineSeveral(p: ByDefineSeveral, really: boolean): string {
  const before = p.norm();
  const target: Target = really ? p : spare();
  Object.defineProperties(target, { norm: { value: replacement, writable: true, configurable: true } });
  return before + " " + p.norm();
}

{
  const p = new ByDefineSeveral();
  drive("Object.defineProperties", p, p, byDefineSeveral);
}

class ByReflectSet {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function byReflectSet(p: ByReflectSet, really: boolean): string {
  const before = p.norm();
  const target: Target = really ? p : spare();
  Reflect.set(target, "norm", replacement);
  return before + " " + p.norm();
}

{
  const p = new ByReflectSet();
  drive("Reflect.set", p, p, byReflectSet);
}

class ByReflectDefine {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function byReflectDefine(p: ByReflectDefine, really: boolean): string {
  const before = p.norm();
  const target: Target = really ? p : spare();
  Reflect.defineProperty(target, "norm", { value: replacement, writable: true, configurable: true });
  return before + " " + p.norm();
}

{
  const p = new ByReflectDefine();
  drive("Reflect.defineProperty", p, p, byReflectDefine);
}

class ByGetter {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function byGetter(p: ByGetter, really: boolean): string {
  const before = p.norm();
  const target: Target = really ? p : spare();
  Object.defineProperty(target, "norm", { get: () => replacement, configurable: true });
  return before + " " + p.norm();
}

{
  const p = new ByGetter();
  drive("a getter", p, p, byGetter);
}

class ByComputedName {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function byComputedName(p: ByComputedName, really: boolean): string {
  const before = p.norm();
  const target: Target = really ? p : spare();
  target[key] = replacement;
  return before + " " + p.norm();
}

{
  const p = new ByComputedName();
  drive("a computed name", p, p, byComputedName);
}

class ByProxy {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function byProxy(p: ByProxy, really: boolean): string {
  const before = p.norm();
  const target: Target = really ? p : spare();
  new Proxy(target, {}).norm = replacement;
  return before + " " + p.norm();
}

{
  const p = new ByProxy();
  drive("a store through a proxy", p, p, byProxy);
}

class ByPattern {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function byPattern(p: ByPattern, really: boolean): string {
  const before = p.norm();
  const target: Target = really ? p : spare();
  ({ norm: target.norm } = { norm: replacement });
  return before + " " + p.norm();
}

{
  const p = new ByPattern();
  drive("an object pattern", p, p, byPattern);
}

export {};
