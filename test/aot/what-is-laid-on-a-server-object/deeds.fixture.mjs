import http from "node:http";
const deeds = [
  ['quiet', 'yes', (server, laid, other, heard) => {  }],
  ['a value stored through the accessor', 'yes', (server, laid, other, heard) => { server.maxHeadersCount = 50; }],
  ['the same two functions laid again', 'yes', (server, laid, other, heard) => { Object.defineProperty(server, "maxHeadersCount", { get: laid.get, set: laid.set }); }],
  ['the same two functions with other attributes', 'no', (server, laid, other, heard) => { Object.defineProperty(server, "maxHeadersCount", { get: laid.get, set: laid.set, enumerable: false }); }],
  ['a getter of the program', 'no', (server, laid, other, heard) => { Object.defineProperty(server, "maxHeadersCount", { get() { heard.push("get"); return 7; } }); }],
  ['a setter of the program', 'no', (server, laid, other, heard) => { Object.defineProperty(server, "maxHeadersCount", { set(value) { heard.push("set " + value); } }); server.maxHeadersCount = 9; }],
  ['a half taken away', 'no', (server, laid, other, heard) => { Object.defineProperty(server, "maxHeadersCount", { set: undefined }); }],
  ['a bound function', 'no', (server, laid, other, heard) => { Object.defineProperty(server, "maxHeadersCount", { get: laid.get.bind(server) }); }],
  ['a proxy round the getter', 'no', (server, laid, other, heard) => { Object.defineProperty(server, "maxHeadersCount", { get: new Proxy(laid.get, { apply(target, self) { heard.push("apply"); return Reflect.apply(target, self, []); } }) }); }],
  ['another function of the library replaces the getter', 'no', (server, laid, other, heard) => { Object.defineProperty(server, "maxHeadersCount", { get: other.get }); }],
  ['deleted', 'no', (server, laid, other, heard) => { delete server.maxHeadersCount; }],
  ['deleted and the same two laid', 'no', (server, laid, other, heard) => { delete server.maxHeadersCount; Object.defineProperty(server, "maxHeadersCount", laid); }],
  ['deleted and another function of the library laid', 'no', (server, laid, other, heard) => { delete server.maxHeadersCount; Object.defineProperty(server, "maxHeadersCount", { ...laid, get: other.get }); }],
  ['deleted and a getter of the program laid', 'no', (server, laid, other, heard) => { delete server.maxHeadersCount; Object.defineProperty(server, "maxHeadersCount", { get() { heard.push("get"); return 7; }, enumerable: true, configurable: true }); }],
  ['a plain value in its place', 'no', (server, laid, other, heard) => { Object.defineProperty(server, "maxHeadersCount", { value: 5, writable: true }); }],
  ['an accessor of the program under a field', 'no', (server, laid, other, heard) => { let held = server.timeout; Object.defineProperty(server, "timeout", { get() { heard.push("timeout"); return held; }, set(value) { held = value; }, enumerable: true, configurable: true }); }],
];
async function take(deed) {
  const heard = [], callers = [];
  const server = http.createServer((request, response) => {
    callers.push((new Error().stack.split("\n")[2] ?? "nobody").trim());
    response.end("ok " + server.maxHeadersCount);
  });
  deed(server, Object.getOwnPropertyDescriptor(server, "maxHeadersCount"), Object.getOwnPropertyDescriptor(server, "httpAllowHalfOpen"), heard);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let text = "";
  for (let turn = 0; turn < 3; turn++) text += (await (await fetch(`http://127.0.0.1:${server.address().port}/`)).text()) + ";";
  await new Promise(resolve => server.close(resolve));
  return { text, heard: [...new Set(heard)].join(), callers: [...new Set(callers)].join(" & ") };
}
const taken = [];
for (const [label, expected, deed] of deeds) taken.push([label, expected, await take(deed)]);
Object.defineProperty(http.ServerResponse.prototype, "madeUpTrace", { get() { return 1; }, configurable: true });
const full = (await take(() => {})).callers, short = taken[0][2].callers;
for (const [label, expected, { text, heard }] of taken) console.log(`answer: ${label}: ${text} ${heard}`);
console.log(`roads differ: ${short !== full}`);
for (const [label, expected, { callers }] of taken) console.log(`road: ${label}: expected ${expected === "yes" ? "short" : "full"}: ${callers === short ? "short" : callers === full ? "full" : "other " + callers}`);
