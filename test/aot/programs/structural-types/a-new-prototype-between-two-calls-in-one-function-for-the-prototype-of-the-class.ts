const spare: object = {};
const parent = {
  norm(): number {
    return -1;
  },
};
const setter = Object.getOwnPropertyDescriptor(Object.prototype, "__proto__")?.set;
const renamed = Object.setPrototypeOf;

function drive<T>(label: string, p: T, below: object, run: (p: T, really: boolean) => string): void {
  let warm = 0;
  for (let i = 0; i < 2000; i++) warm += run(p, false).length;
  const above = Object.getPrototypeOf(below);
  const parts = [String(warm), run(p, false), run(p, true), run(p, false)];
  Object.setPrototypeOf(below, above);
  parts.push(run(p, false));
  console.log(label + ": " + parts.join(" | "));
}

class BySetPrototypeOfBase {
  n = 1;
  norm(): number {
    return this.n;
  }
}

class BySetPrototypeOf extends BySetPrototypeOfBase {}

function bySetPrototypeOf(p: BySetPrototypeOf, really: boolean): string {
  const before = p.norm();
  const target: object = really ? BySetPrototypeOf.prototype : spare;
  Object.setPrototypeOf(target, parent);
  return before + " " + p.norm() + " " + (p instanceof BySetPrototypeOfBase);
}

{
  const p = new BySetPrototypeOf();
  drive("Object.setPrototypeOf", p, BySetPrototypeOf.prototype, bySetPrototypeOf);
}

class ByReflectSetPrototypeOfBase {
  n = 1;
  norm(): number {
    return this.n;
  }
}

class ByReflectSetPrototypeOf extends ByReflectSetPrototypeOfBase {}

function byReflectSetPrototypeOf(p: ByReflectSetPrototypeOf, really: boolean): string {
  const before = p.norm();
  const target: object = really ? ByReflectSetPrototypeOf.prototype : spare;
  Reflect.setPrototypeOf(target, parent);
  return before + " " + p.norm() + " " + (p instanceof ByReflectSetPrototypeOfBase);
}

{
  const p = new ByReflectSetPrototypeOf();
  drive("Reflect.setPrototypeOf", p, ByReflectSetPrototypeOf.prototype, byReflectSetPrototypeOf);
}

class ByProtoSetterBase {
  n = 1;
  norm(): number {
    return this.n;
  }
}

class ByProtoSetter extends ByProtoSetterBase {}

function byProtoSetter(p: ByProtoSetter, really: boolean): string {
  const before = p.norm();
  const target: object = really ? ByProtoSetter.prototype : spare;
  setter?.call(target, parent);
  return before + " " + p.norm() + " " + (p instanceof ByProtoSetterBase);
}

{
  const p = new ByProtoSetter();
  drive("the setter of __proto__", p, ByProtoSetter.prototype, byProtoSetter);
}

class ByAnotherNameBase {
  n = 1;
  norm(): number {
    return this.n;
  }
}

class ByAnotherName extends ByAnotherNameBase {}

function byAnotherName(p: ByAnotherName, really: boolean): string {
  const before = p.norm();
  const target: object = really ? ByAnotherName.prototype : spare;
  renamed(target, parent);
  return before + " " + p.norm() + " " + (p instanceof ByAnotherNameBase);
}

{
  const p = new ByAnotherName();
  drive("under another name", p, ByAnotherName.prototype, byAnotherName);
}

class ByProxiedLinkBase {
  n = 1;
  norm(): number {
    return this.n;
  }
}

class ByProxiedLink extends ByProxiedLinkBase {}

function byProxiedLink(p: ByProxiedLink, really: boolean): string {
  const before = p.norm();
  const target: object = really ? ByProxiedLink.prototype : spare;
  Object.setPrototypeOf(new Proxy(target, {}), parent);
  return before + " " + p.norm() + " " + (p instanceof ByProxiedLinkBase);
}

{
  const p = new ByProxiedLink();
  drive("through a proxy", p, ByProxiedLink.prototype, byProxiedLink);
}

export {};
