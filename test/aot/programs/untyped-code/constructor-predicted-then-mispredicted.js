// One constructor fills two kinds of objects in turn: for one nothing stands in the way, the other inherits a setter for one of the names, as Node's OutgoingMessage fills a ClientRequest and a ServerResponse in one process.
// What the objects have. Only the jsc shell can count. Elsewhere the program checks the answers alone.
const counts = typeof aotOperationCount === "function";
const count = counts ? aotOperationCount : () => 0;
let calls = 0;
function Message(options) {
  this.outputData = [];
  this.outputSize = 0;
  this.guarded = options;
  this.destroyed = false;
  this.last = false;
}
const library = { Message: function Unused() {} };
library.Message = Message;
function Client(options) { library.Message.call(this, options); }
Object.setPrototypeOf(Client.prototype, Message.prototype);
function Server(options) { library.Message.call(this, options); }
Object.setPrototypeOf(Server.prototype, Message.prototype);
const name = ["guar", "ded"].join("");
Object.defineProperty(Object.getPrototypeOf(new Server(0)), name, { get() { return "by getter"; }, set(value) { calls++; this.kept = value; }, configurable: true });
function describe(object) { return object.constructor.name + " " + Object.keys(object).map(key => key + "=" + JSON.stringify(object[key])).join() + " " + object.guarded; }

const said = new Set();
const before = count("operationAOTTryPutProperties");
for (let i = 0; i < 3000; i++) {
  said.add(describe(new Client(1)));
  said.add(describe(new Server(2)));
}
const asked = count("operationAOTTryPutProperties") - before;
console.log([...said].join("\n"));
console.log(calls, asked <= 100 ? "the run time worked it out at most 100 times" : "the run time worked it out " + asked + " times");

// The setter goes, and comes back on the other kind.
delete Object.getPrototypeOf(new Server(0))[name];
calls = 0;
for (let i = 0; i < 100; i++) said.add(describe(new Server(3)));
console.log(describe(new Server(3)), calls);
Object.defineProperty(Object.getPrototypeOf(new Client(0)), name, { get() { return "now here"; }, set(value) { calls++; }, configurable: true });
for (let i = 0; i < 100; i++) said.add(describe(new Client(4)) + describe(new Server(4)));
console.log(describe(new Client(4)), describe(new Server(4)), calls);
