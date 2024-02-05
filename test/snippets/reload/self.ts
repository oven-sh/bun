// const content = await Bun.file(import.meta.path).text();
const content = require("fs").readFileSync(import.meta.path, "utf8");
const timebegin = content.indexOf("\n// time:");
const prev = parseFloat(content.substring(timebegin + 9));
const current = performance.now() + performance.timeOrigin;
console.log(current - prev);
require("fs").writeFileSync(import.meta.path, content.substring(0, timebegin + 9) + current);
// time:0
