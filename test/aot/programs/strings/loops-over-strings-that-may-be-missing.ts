// A value that does not change in a loop and is known to be a string only inside the loop: after `!`, after a test, after a cast.
// The loop reads the characters of the same string each time round, and whatever is no string behaves as it does without a loop.
const log: string[] = []

function asserted(text: string | undefined, count: number): number {
  let total = 0
  for (let i = 0; i < count; i++) {
    log.push('before ' + i)
    total += text!.charCodeAt(i)
  }
  return total
}

function tested(text: string | undefined, count: number): number {
  let total = 0
  for (let i = 0; i < count; i++) {
    if (text !== undefined) total += text.charCodeAt(i)
    else total -= 1
  }
  return total
}

function testedForNull(text: string | null, count: number): string {
  let found = ''
  for (let i = 0; i < count; i++) {
    if (text === null) {
      found += '-'
      continue
    }
    const character = text[i]
    if (character === 'a') found += 'A'
    else if (character === 'b') found += 'B'
    else if (character === 'c') found += 'C'
    else if (character === undefined) found += '?'
    else found += character
  }
  return found
}

function byTypeof(value: unknown, count: number): number {
  let total = 0
  for (let i = 0; i < count; i++) {
    if (typeof value === 'string') total += value.charCodeAt(i) | 0
    else total += 1000
  }
  return total
}

function caughtInside(text: string | undefined, count: number): number {
  let total = 0
  for (let i = 0; i < count; i++) {
    try {
      total += text!.charCodeAt(i)
    } catch (error) {
      total -= (error as Error) instanceof TypeError ? 1 : 100
    }
  }
  return total
}

function nested(text: string | undefined, rows: number, columns: number): number {
  let total = 0
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (text === undefined) break
      total += text.charCodeAt(row * columns + column) | 0
    }
  }
  return total
}

function attempt(name: string, run: () => unknown) {
  log.length = 0
  try {
    console.log(name, run(), log.join(','))
  } catch (error) {
    console.log(name, (error as Error).constructor.name, log.join(','))
  }
}

const flat = 'abcdefgh'
const wide = 'abЖ中😀'
function rope(left: string, right: string): string {
  return left + right + left
}
const texts: (string | undefined)[] = [flat, wide, rope('abc', 'defghijklmnopqrstuvwxyz'), rope(wide, flat).slice(1, 9), '', undefined]
for (const text of texts) {
  for (const count of [0, 1, 3, 12]) {
    attempt('asserted ' + count, () => asserted(text, count))
    attempt('tested ' + count, () => tested(text, count))
    attempt('testedForNull ' + count, () => testedForNull(text === undefined ? null : text, count))
    attempt('caughtInside ' + count, () => caughtInside(text, count))
    attempt('nested ' + count, () => nested(text, count, 2))
  }
}
for (const value of [flat, rope('xy', 'z'), 7, null, undefined, { length: 3 }, ['a'], Symbol.iterator, true]) {
  attempt('byTypeof', () => byTypeof(value, 4))
}
