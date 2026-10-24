// A pattern made from a large text and used once is garbage afterwards, with its text and whatever was made of it.
function use(number) {
  const words = [];
  for (let i = 0; i < 2500; i++) words.push("w" + number + "x" + i);
  return new RegExp("^(?:" + words.join("|") + ")$").test("w" + number + "x2499");
}
for (let number = 0; number < 20; number++) use(-number);
Bun.gc(true);
const before = process.memoryUsage().rss;
let matches = 0;
for (let number = 1; number <= 1000; number++) if (use(number)) matches++;
Bun.gc(true);
const grown = (process.memoryUsage().rss - before) / (1024 * 1024);
if (process.argv[2] === "show") console.log(Math.round(grown) + " MB");
console.log(matches, grown < 150 ? "the memory did not grow with the number of patterns" : "the memory grew by " + Math.round(grown) + " MB");
