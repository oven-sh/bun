type Subject = { name: string; make: () => string }

function flatten(text: string): string {
  text.charCodeAt(0)
  return text
}

function createSubjects(label: string, literal: string, left: string, right: string): Subject[] {
  return [
    { name: `${label} literal`, make: () => literal },
    { name: `${label} flat`, make: () => flatten(left + right) },
    { name: `${label} substring of literal`, make: () => literal.slice(2, literal.length - 2) },
    { name: `${label} substring of flat`, make: () => flatten(left + right).slice(3, -4) },
    { name: `${label} substring of substring`, make: () => flatten(left + right).slice(3, -4).slice(2, -3) },
    { name: `${label} rope`, make: () => left + right },
  ]
}

const narrowLeft = 'abcabd-needle-tail-'.repeat(3)
const narrowRight = 'xyz-abcabd-needle-end-'.repeat(2)
const wideLeft = 'aΔbcabd-needle-tail-'.repeat(3)
const wideRight = 'xyz-abcabd-needle-Δb-end-'.repeat(2)

const subjects: Subject[] = [
  ...createSubjects('narrow', 'abcabd-needle-tail-abcabd-needle-end', narrowLeft, narrowRight),
  ...createSubjects('wide', 'aΔbcabd-needle-tail-abcabd-Δb-end', wideLeft, wideRight),
  { name: 'empty', make: () => '' },
]

const needles: Subject[] = [
  { name: 'flat needle', make: () => flatten('need' + 'le') },
  { name: 'substring needle', make: () => flatten('--needle--' + narrowLeft).slice(2, 8) },
  { name: 'rope needle', make: () => 'abcabd-needle-tail-abcabd-needle-tail-abcabd-' + 'needle-tail-abcabd-needle-tail-abcabd-needle' },
  { name: 'wide needle', make: () => flatten('Δ' + 'b') },
  { name: 'absent needle', make: () => flatten('abs' + 'ent') },
  { name: 'empty needle', make: () => '' },
]

function createStarts(length: number): number[] {
  return [0, 3, length, length + 1, -1, NaN]
}

function searchLiteralsFromStart(text: string): string {
  return [text.indexOf('n'), text.includes('n'), text.indexOf('abd'), text.includes('abd')].join(' ')
}

function searchLiteralsFrom(text: string, start: number): string {
  return [text.indexOf('n', start), text.includes('n', start), text.indexOf('abd', start), text.includes('abd', start)].join(' ')
}

function searchStringFromStart(text: string, needle: string): string {
  return `${text.indexOf(needle)} ${text.includes(needle)}`
}

function searchStringFrom(text: string, needle: string, start: number): string {
  return `${text.indexOf(needle, start)} ${text.includes(needle, start)}`
}

function describe(text: string): string {
  return `${JSON.stringify(text)} ${text.length} ${text.indexOf('b')} ${text.indexOf('abd')} ${text.includes('needle')}`
}

function slice(text: string, from: number, to: number): string {
  return text.slice(from, to)
}

function substring(text: string, from: number, to: number): string {
  return text.substring(from, to)
}

function substr(text: string, from: number, to: number): string {
  return text.substr(from, to)
}

function checkSearches(subject: Subject): void {
  const length = subject.make().length
  console.log(subject.name, 'literals', searchLiteralsFromStart(subject.make()))
  for (const start of createStarts(length)) console.log(subject.name, 'literals from', start, searchLiteralsFrom(subject.make(), start))
  for (const needle of needles) {
    console.log(subject.name, needle.name, searchStringFromStart(subject.make(), needle.make()))
    for (const start of createStarts(length)) console.log(subject.name, needle.name, 'from', start, searchStringFrom(subject.make(), needle.make(), start))
  }
}

function checkSubstrings(subject: Subject): void {
  const length = subject.make().length
  const bounds = [-1, 0, 1, 2, length - 1, length, length + 1]
  for (const from of bounds) {
    for (const to of bounds) {
      console.log(subject.name, 'slice', from, to, describe(slice(subject.make(), from, to)))
      console.log(subject.name, 'substring', from, to, describe(substring(subject.make(), from, to)))
      console.log(subject.name, 'substr', from, to, describe(substr(subject.make(), from, to)))
    }
  }
}

function checkSearchesInsideRange(): void {
  const base = flatten('xx-needle-' + 'yy-needle-zz')
  const cut = base.slice(0, 6)
  console.log('straddles end', cut.indexOf('needle'), cut.includes('needle'), cut.indexOf('d'), cut.includes('d'))
  console.log('straddles end at run time', cut.indexOf(flatten('need' + 'le')), cut.includes(flatten('need' + 'le')))
  const inner = base.slice(3, 12).slice(1, 5)
  console.log('straddles both ends', JSON.stringify(inner), inner.indexOf('needle'), inner.indexOf('n'), inner.indexOf('ee'), inner.indexOf('y'))
  console.log('only before start', base.indexOf('xx', 1), base.includes('xx', 1), base.indexOf('x', 2), base.indexOf(flatten('x' + 'x'), 1))
  console.log('empty needle', cut.indexOf(''), cut.indexOf('', 3), cut.indexOf('', 6), cut.indexOf('', 7), cut.includes('', 7))
}

function checkSwappedBounds(): void {
  const text = flatten('abcdef' + 'ghijkl')
  console.log('slice swapped', JSON.stringify(slice(text, 5, 2)), slice(text, 5, 2).length)
  console.log('substring swapped', JSON.stringify(substring(text, 5, 2)), substring(text, 5, 2).length)
  const wide = flatten('Δbcdef' + 'ghijkΔ')
  console.log('one wide unit', JSON.stringify(slice(wide, 0, 1)), JSON.stringify(slice(wide, 1, 2)))
}

function createBase(index: number): string {
  return flatten(`base-${index}-` + 'abcdefghijklmnopqrstuvwxyz')
}

function checkManySubstrings(): void {
  const retained: string[] = []
  let total = 0
  for (let index = 0; index < 200_000; index++) {
    const cut = createBase(index).slice(5, -3)
    total += cut.length
    if (index % 1_000 === 0) retained.push(cut)
    if ((index + 1) % 50_000 === 0) Bun.gc(true)
  }
  Bun.gc(true)
  let found = 0
  for (const cut of retained) {
    if (cut.indexOf('wxyz') === -1 && cut.indexOf('uvw') === cut.length - 3) found++
  }
  console.log('many substrings', total, retained.length, found, retained[7], retained[retained.length - 1])
}

for (const subject of subjects) {
  checkSearches(subject)
  checkSubstrings(subject)
}
checkSearchesInsideRange()
checkSwappedBounds()
checkManySubstrings()
