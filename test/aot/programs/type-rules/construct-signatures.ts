// `new` on values that are known only by a construct signature: functions, classes and proxies of classes.
function rule(label: string, f: () => unknown) { try { console.log(label + ": no error", f()) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) } }
interface Gauge { level: number; unit: string; read(): string; reset?(): void }
interface GaugeCtor { new (level: number): Gauge; readonly kindName: string }
class ClassGauge implements Gauge {
  static kindName = "class"
  unit = "c"
  level: number
  constructor(level: number) { this.level = level }
  read() { return this.level + this.unit }
}
class ResettableGauge extends ClassGauge {
  static override kindName = "resettable"
  initial: number
  constructor(level: number) { super(level); this.initial = level; this.unit = "r" }
  reset() { this.level = this.initial }
}
function FnGauge(this: Gauge, level: number) { this.level = level; this.unit = "f" }
FnGauge.prototype.read = function (this: Gauge) { return this.unit + ":" + this.level }
FnGauge.kindName = "function"
const byFunction = new (FnGauge as unknown as GaugeCtor)(4)
rule("method on F.prototype", () => byFunction.read())
console.log(byFunction.level + byFunction.unit, Object.keys(byFunction).join())
const constructLog: string[] = []
const ProxiedGauge: typeof ClassGauge = new Proxy(ClassGauge, {
  construct(target, args, newTarget) { constructLog.push("construct " + args.join() + " " + (newTarget === ProxiedGauge)); return Reflect.construct(target, [args[0] * 2], newTarget) },
})
rule("proxy of a class as new.target", () => new ProxiedGauge(4).read())
console.log(constructLog.join(";"), ProxiedGauge.kindName)
class ReturningGauge {
  static kindName = "returning"
  ignored = 1
  constructor(level: number) { return { level, unit: "o", read() { return "other " + this.level } } as any }
}
rule("constructor of a class returns another object", () => new (ReturningGauge as unknown as GaugeCtor)(4).read())
const config: { Gauge: GaugeCtor } = { Gauge: ClassGauge }
rule("field that holds the constructor made an accessor", () => Object.defineProperty(config, "Gauge", { get() { return ClassGauge }, configurable: true, enumerable: true }) === config)
console.log(new config.Gauge(5).read(), typeof Object.getOwnPropertyDescriptor(config, "Gauge")!.get)
