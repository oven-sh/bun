// charCodeAt at a position that no string has, in front of the first character or behind the longest string there can be, answers NaN.
// The path that would read a character ends at once, and the compiler's own checks hold behind every pass (--aot-check=verify-each-pass).
function codeBefore(text) {
  return text.charCodeAt(-1)
}

function codeFarBehind(text) {
  return text.charCodeAt(4294967296)
}

function isEscaped(text, index) {
  return text.charCodeAt(index - 1) === 92
}

const texts = ['abc', '\\(', '', 'x']
let missing = 0
let escaped = 0
for (let i = 0; i < 4000; i++) {
  const text = texts[i & 3]
  if (Number.isNaN(codeBefore(text))) missing++
  if (Number.isNaN(codeFarBehind(text))) missing++
  if (isEscaped(text, 0)) escaped++
  if (isEscaped(text, 1)) escaped++
}
console.log(missing, escaped)
