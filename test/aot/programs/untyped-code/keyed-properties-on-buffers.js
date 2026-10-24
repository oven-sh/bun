// A Buffer that is given properties under computed keys keeps its ArrayBuffer, however often the storing code has run before.
function grow(o, count) { for (let i = 0; i < count; i++) o["many" + i] = i; }
const wrong = [];
for (let count = 1; count <= 40; count++) {
  for (let round = 0; round < 3; round++) {
    const backing = new ArrayBuffer(16);
    const over = Buffer.from(backing);
    grow(over, count);
    const pooled = Buffer.from("hello");
    const pool = pooled.buffer;
    grow(pooled, count);
    const alone = Buffer.alloc(4, 7);
    const parent = alone.parent;
    grow(alone, count);
    let said;
    try { said = over.buffer === backing && pooled.buffer === pool && pooled.toString() === "hello" && alone.parent === parent && alone.buffer === parent && alone[3] === 7 ? "" : "another answer"; } catch (e) { said = e.name + ": " + e.message; }
    if (said) wrong.push(count + " " + round + " " + said);
  }
}
console.log(wrong.length, wrong.slice(0, 3).join(" | "));
