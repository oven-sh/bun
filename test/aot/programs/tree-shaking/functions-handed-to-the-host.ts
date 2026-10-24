// Each function is named once, as an argument to something that calls it later or from native code: timers, microtasks, promise reactions, sort, replace, JSON, array methods, event targets, process events and a finalizer of `using`.
const log: string[] = [];
function onTimeout() { log.push("timeout"); finish(); }
function onMicrotask() { log.push("microtask"); }
function onResolve(value: string) { log.push("then " + value); }
function onReject(error: Error) { log.push("catch " + error.message); }
function onFinally() { log.push("finally"); }
function compare(a: number, b: number) { return b - a; }
function replacer(match: string) { return match.toUpperCase(); }
function reviver(key: string, value: unknown) { return typeof value === "number" ? value + 1 : value; }
function stringifier(key: string, value: unknown) { return typeof value === "number" ? value * 2 : value; }
function mapper(value: number) { return value * 3; }
function reducer(sum: number, value: number) { return sum + value; }
function listener(event: Event) { log.push("event " + event.type); }
function onExit() { console.log(log.join("\n")); }
function finish() { log.push("finished"); }
function executor(resolve: (value: string) => void) { resolve("from the executor"); }

setTimeout(onTimeout, 1);
queueMicrotask(onMicrotask);
Promise.resolve("resolved").then(onResolve).finally(onFinally);
Promise.reject(new Error("rejected")).catch(onReject);
new Promise(executor).then(onResolve);
log.push([1, 3, 2].sort(compare).join());
log.push("abc".replace(/b/, replacer));
log.push(JSON.stringify(JSON.parse('{"a":1}', reviver), stringifier));
log.push(String([1, 2].map(mapper).reduce(reducer, 0)));
const target = new EventTarget();
target.addEventListener("ping", listener);
target.dispatchEvent(new Event("ping"));
(globalThis as any).process.on("exit", onExit);
