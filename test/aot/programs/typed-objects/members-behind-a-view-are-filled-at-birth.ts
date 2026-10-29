// A member whose type is a view (ReadonlyMap) or a bag of optional members is only expected to have that type. It is listed in the allocation like any other, and so are the members written behind it.
// IRT= 0 readBag GetSlotOrUndefined
// IRT= 0 readBag = TypeTest
// IRT= 0 readRequest GetSlotOrUndefined
// IRT= 0 readRequest = TypeTest
interface Bag { table: ReadonlyMap<string, number>; size: number; label: string }
interface Options { retries?: number; verbose?: boolean }
interface Request { options: Options; port: number; host: string }
function makeBag(table: Map<string, number>, size: number, label: string): Bag { return { table, size, label }; }
function makeRequest(options: Options, port: number, host: string): Request { return { options, port, host }; }
function readBag(bag: Bag) { return bag.size + bag.label.length; }
function readRequest(request: Request) { return request.port + request.host.length; }

const stranger: any = JSON.parse(process.argv[2] ?? "null");
for (const read of [readBag, readRequest] as ((value: any) => number)[]) {
  try { console.log(read(stranger)); } catch { console.log("threw"); }
}
const table = new Map([["a", 1]]);
const bags: Bag[] = [];
const requests: Request[] = [];
for (let i = 0; i < 300; i++) {
  bags.push(makeBag(table, i, i & 1 ? "ab" : "abc"));
  requests.push(makeRequest(i & 1 ? {} : { retries: i }, i, i & 1 ? "ab" : "abc"));
}
let sum = 0;
for (let round = 0; round < 20; round++) {
  for (let i = 0; i < 300; i++) sum += readBag(bags[i]) + readRequest(requests[i]);
}
console.log(sum, Object.keys(bags[3]).join(), JSON.stringify(requests[4]), bags[5].table.get("a"));
