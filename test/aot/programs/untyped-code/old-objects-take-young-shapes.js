// `o[key] = v`, v a number, a boolean, null or undefined, on an OLD object, where the store needs no new storage and the shape it leads to is YOUNG: it was made since the last collection, by the same store on objects that have died since. Nothing but the old object holds that shape then, and a collection of the young looks at an old object only if it has been told of it, whatever the value stored is.
const three = '{"a":1,"b":2,"c":3}';
const values = [0, true, null, undefined, 1.5, false];
function put(o, k, v) { o[k] = v; }
function get(o, k) { return o[k]; }
let kept = 0;
function churn(n) { for (let i = 0; i < n; i++) kept += JSON.parse(three).c + [i, i + 1, i + 2, i + 3].length; if (typeof edenGC === "function") edenGC(); }
const batches = 12, inBatch = 150, count = batches * inBatch;
const old = [], keys = [];
for (let i = 0; i < count; i++) old.push(JSON.parse(three));
churn(400000);
for (let batch = 0; batch < batches; batch++) {
  for (let i = batch * inBatch; i < (batch + 1) * inBatch; i++) {
    const key = "k" + i;
    keys.push(key);
    for (let turn = 0; turn < 6; turn++) put(JSON.parse(three), key, turn);
    put(old[i], key, values[i % values.length]);
  }
  churn(400000);
}
let wrongValues = 0, wrongKeys = 0;
for (let i = 0; i < count; i++) {
  if (get(old[i], keys[i]) !== values[i % values.length]) wrongValues++;
  if (Object.keys(old[i]).join() !== "a,b,c," + keys[i]) wrongKeys++;
}
console.log(wrongValues, wrongKeys, kept);
