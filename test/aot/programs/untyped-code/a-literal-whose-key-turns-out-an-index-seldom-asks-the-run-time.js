// `{ name: value, [key]: value }` with a key that turns out an index, or the text of one: compiled code gives the new object its first element itself. The run time is asked while it learns the shape and where an allocator has run out.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const asked = () => count("operationAOTDefineField") + count("operationAOTDefineById") + count("operationAOTPutByVal") + count("operationAOTPutByValGeneric");
function beside(key, value) { return { name: value, [key]: value }; }
function stored(key, value) { const made = { name: value }; made[key] = value; return made; }
const texts = ["0", "1", "2", "3", "4", "5", "6", "7"];
let sum = 0;
for (let i = 0; i < 64; i++) sum += beside(i & 7, i)[i & 7] + beside(texts[i & 7], i)[i & 7] + stored(texts[i & 7], i)[i & 7];
const learned = asked();
for (let i = 0; i < 4000; i++) sum += beside(i & 7, i)[i & 7] + beside(texts[i & 7], i)[i & 7] + stored(texts[i & 7], i)[i & 7];
console.log(sum, "the run time is asked for fewer than one in twenty of 12000 new objects:", asked() - learned < 600, "and was asked while it learned:", typeof aotOperationCount !== "function" || learned > 0);
