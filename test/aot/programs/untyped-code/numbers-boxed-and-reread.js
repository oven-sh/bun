// Numbers of plain JavaScript that are made and looked at again at once: lengths, character codes and counters in loops over strings and arrays of unknown type, at the edges of int32 too.
const scan = (text, from) => {
  let i = from, sum = 0;
  for (; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 37) return "percent at " + i;
    if (code === 63) break;
    sum += code;
  }
  return i + ":" + sum;
};
const countDown = (list) => {
  let n = 0;
  for (let i = list.length - 1; i >= 0; i--) n += list[i].length;
  return n;
};
const step = (start, by, turns) => {
  let i = start;
  for (let k = 0; k < turns; k++) i += by;
  return i;
};
const holder = { scan, countDown, step };
const texts = JSON.parse('["http://localhost/user","/a?b","100%","","\\u20ac\\u20ac?","plain"]');
for (const text of texts) console.log(holder.scan(text, 0), holder.scan(text, 2), holder.scan(text, 100), holder.scan(text, -0), holder.scan(text, 1.5), holder.scan(text, "1"), holder.scan(text, undefined));
console.log(holder.scan({ length: 3, charCodeAt: (i) => 60 + i }, 0), holder.scan({ length: 2.5, charCodeAt: (i) => i / 2 }, 0), holder.scan({ length: "2", charCodeAt: () => "7" }, 0));
console.log(holder.countDown(texts), holder.countDown([[1, 2], "abc", { length: 0.5 }]), holder.countDown([]));
console.log(holder.step(2147483640, 1, 10), holder.step(-2147483640, -1, 10), holder.step(2147483647, 2147483647, 3), holder.step(0, 0.5, 3), holder.step("a", 1, 2), holder.step(0, -0, 1), Object.is(holder.step(-0, -0, 1), -0), String(holder.step(1n, 2n, 3)));
let total = 0;
for (let turn = 0; turn < 20000; turn++) total += holder.scan(texts[turn % 6], turn & 3).length + holder.step(turn, 3, 4);
console.log(total);
