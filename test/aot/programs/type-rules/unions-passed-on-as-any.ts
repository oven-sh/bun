// A value of a union with a record in it is passed on `as any` to a parameter whose union has another record in it. The members of the unions that are no records pass as they are.
interface Container { fn: number }
function on(handler: string | Container): string { return typeof handler === "string" ? "string " + handler : "container " + handler.fn }
function onError(options: { as: string } | string): string { return on(options as any) }
function onErrorThroughVariable(options: { as: string } | string): string { const loose: any = options; return on(loose) }
console.log(onError("text"), "|", onErrorThroughVariable("text"))
interface Hook { fn: Function; scope?: string }
function onHook(handler: Function | Hook | (Function | Hook)[]): string { return Array.isArray(handler) ? "array " + handler.length : typeof handler === "function" ? "function " + handler() : "hook " + handler.fn() }
function onFunction(options: { as: string } | Function | Function[]): string { return onHook(options as any) }
console.log(onFunction(() => 1.5), "|", onFunction([() => 1, () => 2]))
interface Sized { size: number }
function measure(value: number | boolean | null | undefined | Sized): string { return value === null ? "null" : typeof value === "object" ? "sized " + value.size : String(value) }
function pass(value: { name: string } | number | boolean | null | undefined): string { return measure(value as any) }
console.log(pass(2.5), pass(true), pass(null), pass(undefined))
interface System { read(): string }
interface Host { write(text: string): string }
const system: System = { read: () => "read" }
const host: Host = system as any
;(host as any).write = (text: string) => "wrote " + text
console.log(host.write("x"), system.read(), (host as unknown) === system)
function both(value: { as: string } | string): string { const container: string | Container = value as any; if (typeof container !== "string") { (container as any).fn = 3.5; return "container " + container.fn + " " + (value as { as: string }).as } return container }
console.log(both("plain"), "|", both({ as: "local" }))
