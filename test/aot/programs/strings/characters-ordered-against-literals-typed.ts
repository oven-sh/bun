// The full types of characters-ordered-against-literals.js: one character of a string against a one-character literal, with every operator, from both sides,
// at positions inside and outside the string. Outside it s[i] is undefined, for which no relation holds, and s.charAt(i) is the empty string.
function element_lt(s: string, i: number): boolean {
  return s[i | 0] < 'm'
}
function element_lt_literalFirst(s: string, i: number): boolean {
  return 'm' < s[i | 0]
}
function element_le(s: string, i: number): boolean {
  return s[i | 0] <= 'm'
}
function element_le_literalFirst(s: string, i: number): boolean {
  return 'm' <= s[i | 0]
}
function element_gt(s: string, i: number): boolean {
  return s[i | 0] > 'm'
}
function element_gt_literalFirst(s: string, i: number): boolean {
  return 'm' > s[i | 0]
}
function element_ge(s: string, i: number): boolean {
  return s[i | 0] >= 'm'
}
function element_ge_literalFirst(s: string, i: number): boolean {
  return 'm' >= s[i | 0]
}
function element_eq(s: string, i: number): boolean {
  return s[i | 0] === 'm'
}
function element_eq_literalFirst(s: string, i: number): boolean {
  return 'm' === s[i | 0]
}
function element_ne(s: string, i: number): boolean {
  return s[i | 0] !== 'm'
}
function element_ne_literalFirst(s: string, i: number): boolean {
  return 'm' !== s[i | 0]
}
function element_looseEq(s: string, i: number): boolean {
  return s[i | 0] == 'm'
}
function element_looseEq_literalFirst(s: string, i: number): boolean {
  return 'm' == s[i | 0]
}
function charAt_lt(s: string, i: number): boolean {
  return s.charAt(i) < 'm'
}
function charAt_lt_literalFirst(s: string, i: number): boolean {
  return 'm' < s.charAt(i)
}
function charAt_le(s: string, i: number): boolean {
  return s.charAt(i) <= 'm'
}
function charAt_le_literalFirst(s: string, i: number): boolean {
  return 'm' <= s.charAt(i)
}
function charAt_gt(s: string, i: number): boolean {
  return s.charAt(i) > 'm'
}
function charAt_gt_literalFirst(s: string, i: number): boolean {
  return 'm' > s.charAt(i)
}
function charAt_ge(s: string, i: number): boolean {
  return s.charAt(i) >= 'm'
}
function charAt_ge_literalFirst(s: string, i: number): boolean {
  return 'm' >= s.charAt(i)
}
function charAt_eq(s: string, i: number): boolean {
  return s.charAt(i) === 'm'
}
function charAt_eq_literalFirst(s: string, i: number): boolean {
  return 'm' === s.charAt(i)
}
function charAt_ne(s: string, i: number): boolean {
  return s.charAt(i) !== 'm'
}
function charAt_ne_literalFirst(s: string, i: number): boolean {
  return 'm' !== s.charAt(i)
}
function charAt_looseEq(s: string, i: number): boolean {
  return s.charAt(i) == 'm'
}
function charAt_looseEq_literalFirst(s: string, i: number): boolean {
  return 'm' == s.charAt(i)
}
function isDigit(s: string, i: number): boolean {
  const c = s[i | 0]
  return c >= '0' && c <= '9'
}
function isLetter(s: string, i: number): boolean {
  const c = s.charAt(i)
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'
}
function isBelowSpaceOrMissing(s: string, i: number): boolean {
  return s.charAt(i) <= ' '
}
function kind(s: string, i: number): number {
  const c = s[i | 0]
  if (c === '(') return 1
  if (c === ')') return 2
  if (c === '[') return 3
  if (c === ']') return 4
  return 0
}
function kindByCharAt(s: string, i: number): number {
  const c = s.charAt(i)
  if (c === '(') return 1
  if (c === ')') return 2
  if (c === '[') return 3
  if (c === ']') return 4
  if (c === '') return -1
  return 0
}
function kindBySwitch(s: string, i: number): number {
  switch (s.charAt(i)) {
    case 'a':
      return 1
    case 'm':
      return 2
    case '\u4e2d':
      return 3
    case 'z':
      return 4
    default:
      return 0
  }
}
function wideLiteral(s: string, i: number): string {
  return [s[i | 0] < '\u4e2d', s[i | 0] > '\u4e2d', s.charAt(i) < '\uffff', s.charAt(i) >= '\u0000', s[i | 0] <= '\uffff', s.charAt(i) <= '\u0000'].join()
}
function ofSlice(s: string, i: number): string {
  const part = s.slice(1, 4)
  return [part[i | 0] === 'm', part.charAt(i) < 'm', part.charAt(i) >= 'm', part[i | 0] <= 'm'].join()
}
function answers(s: string, i: number): string {
  let bits = ''
  bits += element_lt(s, i) ? '1' : '0'
  bits += element_lt_literalFirst(s, i) ? '1' : '0'
  bits += element_le(s, i) ? '1' : '0'
  bits += element_le_literalFirst(s, i) ? '1' : '0'
  bits += element_gt(s, i) ? '1' : '0'
  bits += element_gt_literalFirst(s, i) ? '1' : '0'
  bits += element_ge(s, i) ? '1' : '0'
  bits += element_ge_literalFirst(s, i) ? '1' : '0'
  bits += element_eq(s, i) ? '1' : '0'
  bits += element_eq_literalFirst(s, i) ? '1' : '0'
  bits += element_ne(s, i) ? '1' : '0'
  bits += element_ne_literalFirst(s, i) ? '1' : '0'
  bits += element_looseEq(s, i) ? '1' : '0'
  bits += element_looseEq_literalFirst(s, i) ? '1' : '0'
  bits += charAt_lt(s, i) ? '1' : '0'
  bits += charAt_lt_literalFirst(s, i) ? '1' : '0'
  bits += charAt_le(s, i) ? '1' : '0'
  bits += charAt_le_literalFirst(s, i) ? '1' : '0'
  bits += charAt_gt(s, i) ? '1' : '0'
  bits += charAt_gt_literalFirst(s, i) ? '1' : '0'
  bits += charAt_ge(s, i) ? '1' : '0'
  bits += charAt_ge_literalFirst(s, i) ? '1' : '0'
  bits += charAt_eq(s, i) ? '1' : '0'
  bits += charAt_eq_literalFirst(s, i) ? '1' : '0'
  bits += charAt_ne(s, i) ? '1' : '0'
  bits += charAt_ne_literalFirst(s, i) ? '1' : '0'
  bits += charAt_looseEq(s, i) ? '1' : '0'
  bits += charAt_looseEq_literalFirst(s, i) ? '1' : '0'
  bits += isDigit(s, i) ? '1' : '0'
  bits += isLetter(s, i) ? '1' : '0'
  bits += isBelowSpaceOrMissing(s, i) ? '1' : '0'
  return bits
}
function rope(a: string, b: string): string {
  return a + b
}
const texts: string[] = ['', 'm', 'almz', 'a\u4e2dm\uffff\u0000', rope('0123456789abc', 'mnopqrstuvwxyz_AZ ()[]'), rope('xyzm', 'mm').slice(2), '\ud83d\ude00m']
const positions: number[] = [0, 1, 2, 3, 4, 5, 13, 30, 100, -1, -2, -100, 2147483647, -2147483648, 4294967296, 1.5, -0.5, -0, NaN, Infinity, -Infinity]
for (const text of texts) {
  for (const position of positions) {
    console.log(JSON.stringify(text), position, answers(text, position), kind(text, position), kindByCharAt(text, position), kindBySwitch(text, position), wideLiteral(text, position), ofSlice(text, position))
  }
}
