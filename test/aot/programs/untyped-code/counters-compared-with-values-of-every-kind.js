// A counter that the compiler keeps as an integer is compared with a value it knows nothing about but expects to be a number.
function countBelow(holder) {
  let turns = 0;
  for (let i = 0; i < holder.limit; i++) turns++;
  return turns;
}
function countUpTo(holder) {
  let turns = 0;
  for (let i = 0; i <= holder.limit; i++) turns++;
  return turns;
}
function countDownTo(holder) {
  let turns = 0;
  for (let i = 10; i > holder.limit && turns < 40; i--) turns++;
  return turns;
}
function countDownThrough(holder) {
  let turns = 0;
  for (let i = 10; i >= holder.limit && turns < 40; i--) turns++;
  return turns;
}
function limitFirst(holder) {
  let turns = 0;
  for (let i = 0; holder.limit > i; i++) turns++;
  for (let i = 0; holder.limit >= i; i++) turns++;
  for (let i = 10; holder.limit < i && turns < 80; i--) turns++;
  for (let i = 10; holder.limit <= i && turns < 120; i--) turns++;
  return turns;
}
function once(counter, holder) {
  counter = counter + 1 - 1;
  return [counter < holder.limit, counter <= holder.limit, counter > holder.limit, counter >= holder.limit, holder.limit < counter, holder.limit >= counter].join();
}
let asked = 0;
const limits = [
  0, 1, 7, -1, -0, 7.5, 6.999, 0.5, -0.5, NaN, Infinity - Infinity, 12, "5", "5.5", "", "x", null, undefined, true, false, 5n, -5n,
  { valueOf: () => (asked++, 4) }, { toString: () => "3" }, [6], [], [1, 2], new Date(8), new Number(9),
];
for (const limit of limits) {
  const holder = { limit };
  const label = typeof limit === "bigint" ? limit + "n" : typeof limit === "object" && limit !== null ? Object.prototype.toString.call(limit) : Object.is(limit, -0) ? "-0" : String(limit);
  console.log(label, countBelow(holder), countUpTo(holder), countDownTo(holder), countDownThrough(holder), limitFirst(holder));
}
console.log("valueOf ran", asked);

const counters = [0, 1, -1, 2147483647, 2147483648, -2147483648, -2147483649, 4294967296, 9007199254740991, -9007199254740991];
const bounds = [0, 2147483647, -2147483648, 2147483647.5, 2147483648, -2147483649, 4294967296, 9007199254740991, 9007199254740992, 1e300, -1e300, Infinity, -Infinity, NaN, "2147483648"];
for (const counter of counters) for (const limit of bounds) console.log(counter, limit, once(counter, { limit }));

function wideCounter(holder) {
  let turns = 0;
  for (let i = 2147483640; i < holder.limit; i++) turns++;
  return turns;
}
console.log(wideCounter({ limit: 2147483647 }), wideCounter({ limit: 2147483660 }), wideCounter({ limit: 2147483650.5 }), wideCounter({ limit: 5 }), wideCounter({ limit: "2147483645" }));

function throwing(holder) {
  try {
    for (let i = 0; i < holder.limit; i++) return "ran";
    return "did not run";
  } catch (error) {
    return error instanceof TypeError ? "TypeError" : String(error);
  }
}
console.log(throwing({ limit: Symbol("s") }), throwing({ limit: { valueOf() { throw "thrown"; } } }), throwing({ limit: Object.create(null) }), throwing({ get limit() { throw "getter"; } }));

function changingLimit(list) {
  let seen = 0;
  for (let i = 0; i < list.length; i++) {
    seen += list[i];
    if (i === 1) list.length = 3;
    if (i === 2) list.push(100);
  }
  return seen;
}
console.log(changingLimit([1, 2, 3, 4, 5, 6]));
