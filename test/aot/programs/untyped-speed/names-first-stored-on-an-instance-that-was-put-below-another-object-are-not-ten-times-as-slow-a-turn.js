// Each turn makes an instance of a class and stores four names on it that its constructor does not store. In the second loop Object.setPrototypeOf() has put the instance below an object created from the class's prototype object first, as a framework does with the requests of a server. That turn may cost a few times the other, not ten times.
class Message {
  constructor(count) {
    this.count = count;
  }
}
const above = Object.create(Message.prototype);
let sums = 0;
globalThis.held = null;
function finish(message, i) {
  message.next = i;
  message.params = i + 1;
  message.route = i + 2;
  message.body = i + 3;
  globalThis.held = message;
  return message.next + message.body;
}
function fastestOf(runs, loop) {
  let fastest = Infinity;
  for (let run = 0; run < runs; run++) {
    const began = performance.now();
    loop();
    fastest = Math.min(fastest, performance.now() - began);
  }
  return fastest;
}
const asBorn = fastestOf(5, () => {
  let sum = 0;
  for (let i = 0; i < 1_000_000; i++) sum = (sum + finish(new Message(i), i & 7)) | 0;
  sums = (sums + sum) | 0;
});
const putBelow = fastestOf(5, () => {
  let sum = 0;
  for (let i = 0; i < 1_000_000; i++) sum = (sum + finish(Object.setPrototypeOf(new Message(i), above), i & 7)) | 0;
  sums = (sums + sum) | 0;
});
console.log(sums, Object.keys(globalThis.held).join(), Object.getPrototypeOf(globalThis.held) === above);
console.log(putBelow < asBorn * 10 ? "under ten times the time" : "over ten times the time");
