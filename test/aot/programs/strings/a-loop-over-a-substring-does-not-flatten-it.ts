// What slice, substring and substr return shares the characters of the string it was cut from. A loop over its characters reads them where they
// lie: it does not ask the runtime for a flat copy of the string's header first. A string put together with + is still flattened once.
// Only the jsc shell with --aotCountsPath=<path> can count. Elsewhere the program checks the answers alone.
declare const aotOperationCount: undefined | ((name: string) => number)
const count = typeof aotOperationCount === 'function' ? aotOperationCount : () => 0

function isClean(path: string): boolean {
  for (let i = 1; i < path.length; i++) {
    const code = path.charCodeAt(i)
    if (code === 37 || code === 63 || (code >= 65 && code <= 90) || (code === 47 && path.charCodeAt(i - 1) === 47)) return false
  }
  return true
}
function sum(text: string): number {
  let total = 0
  for (let i = 0; i < text.length; i++) total += text.charCodeAt(i)
  return total
}
function sumGuarded(text: string): number {
  let total = 0
  try {
    for (let i = 0; i < text.length; i++) {
      total += text.charCodeAt(i)
      if (total < 0) throw new Error('never')
    }
  } catch {
    total = -1
  }
  return total
}

const urls: Array<string> = []
for (let i = 0; i < 64; i++) urls.push('http://localhost:' + (3000 + i) + '/users/' + i + '/posts/hello-world' + (i % 7 === 0 ? '?page=2' : ''))
for (const url of urls) sum(url)

let clean = 0, total = 0
const before = count('operationAOTFlatten')
for (let turn = 0; turn < 50; turn++) {
  for (const url of urls) {
    const path = url.slice(url.indexOf('/', 8))
    if (isClean(path)) clean++
    total += sum(path.substring(1, 9)) + sumGuarded(path.substr(2, 12))
  }
}
const flattened = count('operationAOTFlatten') - before
console.log(clean, total, flattened < 3300 ? 'substrings were read in place' : 'flattened ' + flattened + ' times')

const wide = 'préfixe/Zoë/Müller/日本語/конец'
console.log(sum(wide.slice(8)), sum(wide.slice(8, 11)), sum(wide.slice(19, 22)), isClean(wide.slice(7)), sum(wide.slice(3, 3)), sum(wide.slice(4, 5)))
let joined = ''
for (let i = 0; i < 20; i++) joined += 'part' + i + '/'
console.log(sum(joined), isClean(joined), sum(joined.slice(5)), sum((joined + wide).slice(90)), sumGuarded((wide + joined).slice(10, 60)))
function shrinking(text: string): number {
  let total = 0
  for (let i = 0; i < text.length; i++) {
    total += text.charCodeAt(i)
    if (i % 5 === 4) text = text.slice(1)
  }
  return total
}
console.log(shrinking(joined.slice(3)), shrinking(wide.slice(2)), shrinking(urls[7].slice(7)))
