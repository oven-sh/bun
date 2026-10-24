// Instances of a class that Object.setPrototypeOf() puts below an object created from the class's prototype object, as a framework does with the requests of a server. A call of a method of that object may cost a few times what a call of a method of the class costs on the same instance, not five times.
class Message {
  constructor(count) {
    this.count = count;
  }
  ofTheClass() {
    return this.count + 1;
  }
}
const above = Object.create(Message.prototype);
above.ofTheObjectAbove = function () {
  return this.count + 1;
};
const messages = [];
for (let i = 0; i < 8; i++) messages.push(Object.setPrototypeOf(new Message(i), above));
let sums = 0;
function fastestOf(runs, loop) {
  let fastest = Infinity;
  for (let run = 0; run < runs; run++) {
    const began = performance.now();
    loop();
    fastest = Math.min(fastest, performance.now() - began);
  }
  return fastest;
}
const ofTheClass = fastestOf(5, () => {
  let sum = 0;
  for (let i = 0; i < 5_000_000; i++) sum = (sum + messages[i & 7].ofTheClass()) | 0;
  sums = (sums + sum) | 0;
});
const ofTheObjectAbove = fastestOf(5, () => {
  let sum = 0;
  for (let i = 0; i < 5_000_000; i++) sum = (sum + messages[i & 7].ofTheObjectAbove()) | 0;
  sums = (sums + sum) | 0;
});
console.log(sums, Object.getPrototypeOf(messages[0]) === above);
console.log(ofTheObjectAbove < ofTheClass * 5 ? "under five times the time" : "over five times the time");
