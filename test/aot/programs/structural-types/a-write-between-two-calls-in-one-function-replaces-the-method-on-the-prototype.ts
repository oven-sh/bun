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
  const target: Target = really ? ByStore.prototype : spare();
  target.norm = replacement;
  return before + " " + p.norm();
}

{
  const p = new ByStore();
  drive("a plain store", p, ByStore.prototype, byStore);
}

class ByAssign {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function byAssign(p: ByAssign, really: boolean): string {
  const before = p.norm();
  const target: Target = really ? ByAssign.prototype : spare();
  Object.assign(target, { norm: replacement });
  return before + " " + p.norm();
}

{
  const p = new ByAssign();
  drive("Object.assign", p, ByAssign.prototype, byAssign);
}

class ByDefine {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function byDefine(p: ByDefine, really: boolean): string {
  const before = p.norm();
  const target: Target = really ? ByDefine.prototype : spare();
  Object.defineProperty(target, "norm", { value: replacement, writable: true, configurable: true });
  return before + " " + p.norm();
}

{
  const p = new ByDefine();
  drive("Object.defineProperty", p, ByDefine.prototype, byDefine);
}

class ByDefineSeveral {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function byDefineSeveral(p: ByDefineSeveral, really: boolean): string {
  const before = p.norm();
  const target: Target = really ? ByDefineSeveral.prototype : spare();
  Object.defineProperties(target, { norm: { value: replacement, writable: true, configurable: true } });
  return before + " " + p.norm();
}

{
  const p = new ByDefineSeveral();
  drive("Object.defineProperties", p, ByDefineSeveral.prototype, byDefineSeveral);
}

class ByReflectSet {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function byReflectSet(p: ByReflectSet, really: boolean): string {
  const before = p.norm();
  const target: Target = really ? ByReflectSet.prototype : spare();
  Reflect.set(target, "norm", replacement);
  return before + " " + p.norm();
}

{
  const p = new ByReflectSet();
  drive("Reflect.set", p, ByReflectSet.prototype, byReflectSet);
}

class ByReflectDefine {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function byReflectDefine(p: ByReflectDefine, really: boolean): string {
  const before = p.norm();
  const target: Target = really ? ByReflectDefine.prototype : spare();
  Reflect.defineProperty(target, "norm", { value: replacement, writable: true, configurable: true });
  return before + " " + p.norm();
}

{
  const p = new ByReflectDefine();
  drive("Reflect.defineProperty", p, ByReflectDefine.prototype, byReflectDefine);
}

class ByGetter {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function byGetter(p: ByGetter, really: boolean): string {
  const before = p.norm();
  const target: Target = really ? ByGetter.prototype : spare();
  Object.defineProperty(target, "norm", { get: () => replacement, configurable: true });
  return before + " " + p.norm();
}

{
  const p = new ByGetter();
  drive("a getter", p, ByGetter.prototype, byGetter);
}

class ByComputedName {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function byComputedName(p: ByComputedName, really: boolean): string {
  const before = p.norm();
  const target: Target = really ? ByComputedName.prototype : spare();
  target[key] = replacement;
  return before + " " + p.norm();
}

{
  const p = new ByComputedName();
  drive("a computed name", p, ByComputedName.prototype, byComputedName);
}

class ByProxy {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function byProxy(p: ByProxy, really: boolean): string {
  const before = p.norm();
  const target: Target = really ? ByProxy.prototype : spare();
  new Proxy(target, {}).norm = replacement;
  return before + " " + p.norm();
}

{
  const p = new ByProxy();
  drive("a store through a proxy", p, ByProxy.prototype, byProxy);
}

class ByPattern {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function byPattern(p: ByPattern, really: boolean): string {
  const before = p.norm();
  const target: Target = really ? ByPattern.prototype : spare();
  ({ norm: target.norm } = { norm: replacement });
  return before + " " + p.norm();
}

{
  const p = new ByPattern();
  drive("an object pattern", p, ByPattern.prototype, byPattern);
}

export {};
