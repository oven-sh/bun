// A constructor that declares one parameter and reads the others from `arguments`, as Node's IncomingMessage does in Bun, stores them one after the other.
// What the objects have. Only the jsc shell can count. Elsewhere the program checks the answers alone.
const counts = typeof aotOperationCount === "function";
const count = counts ? aotOperationCount : () => 0;
function Message(socket) {
  this.socket = socket;
  this.url = arguments[1];
  this.method = arguments[2];
  this.handle = arguments[3];
  this.given = arguments.length;
}
Message.prototype.show = function () { return Object.keys(this).map(key => key + "=" + this[key]).join(); };
function Rest(first, ...rest) {
  this.first = first;
  this.second = rest[0];
  this.third = rest[1];
  this.more = rest.length;
}
Rest.prototype.show = Message.prototype.show;
// Two functions are stored under each name: the callee is not known at the call, and is entered the general way, where its arguments lie in memory.
const holder = { Message: function Unused() {}, Rest: function Unused() {} };
holder.Message = Message;
holder.Rest = Rest;
const said = new Set();
const before = count("operationAOTTryPutProperties");
for (let i = 0; i < 2000; i++) {
  said.add(new holder.Message(1, "u", "m", "h").show());
  said.add(new holder.Message(1, "u").show());
  said.add(new holder.Message().show());
  said.add(new holder.Message(1, 2, 3, 4, 5, 6, 7, 8, 9, 10).show());
  said.add(new holder.Rest(1, 2, 3, 4).show());
  said.add(new holder.Rest(1).show());
}
const asked = count("operationAOTTryPutProperties") - before;
console.log([...said].join("\n"));
console.log(!counts || (asked >= 1 && asked <= 300) ? "the stores were learnt together" : "the run time was asked " + asked + " times");

// A store that runs code sees what was stored before it and nothing of what comes behind it.
const log = [];
function define(object, name, descriptor) { Object.defineProperty(object, name, descriptor); }
define(Object.getPrototypeOf(new holder.Message()), "met" + "hod", { get() { return "by getter"; }, set(value) { log.push("set " + value + " behind " + Object.keys(this).join()); }, configurable: true });
console.log(new holder.Message(1, "u", "m", "h").show(), log.splice(0).join());
delete Message.prototype["met" + "hod"];
console.log(new holder.Message(1, "u", "m", "h").show(), log.length);
const existing = { url: "there", other: 1 };
Message.call(existing, "s", "u2", "m2");
console.log(Message.prototype.show.call(existing));
Message.apply(existing, ["s3", "u3", "m3", "h3", "more"]);
console.log(Message.prototype.show.call(existing));
console.log(Reflect.construct(Message, [1, 2, 3]).show());
