// @bun
var { require } = import.meta;
const entrypointPath = "./p.js";
let listener;
try {
  listener = await require(entrypointPath);
} catch (e) {
  console.log(e.code, e.message.split("\n")[0]);
  listener = await import(entrypointPath);
}
for (let i = 0; i < 5; i++) if (listener.default) listener = listener.default;
console.log(listener);
