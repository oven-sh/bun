// Prints the tables of src/format/js/sort_imports/collation_tables.rs from the ICU of the Node.js that runs it.
const base = new Intl.Collator('en', { sensitivity: 'base' });
const accent = new Intl.Collator('en', { sensitivity: 'accent' });
const variant = new Intl.Collator('en', { sensitivity: 'variant' });
const N = 0x250;
const chars = Array.from({ length: N }, (_, cp) => String.fromCodePoint(cp));
const ascii = chars.slice(0, 128).filter(c => base.compare(c, '') !== 0);
const expansions = new Map();
for (const c of chars.slice(128)) {
  if (base.compare(c, '') === 0 || ascii.some(a => base.compare(a, c) === 0)) continue;
  outer: for (const a of ascii) for (const b of ascii) if (base.compare(a + b, c) === 0) { expansions.set(c, (a + b).toLowerCase()); break outer; }
}
const rest = chars.filter(c => base.compare(c, '') !== 0 && !expansions.has(c));
rest.sort((a, b) => base.compare(a, b) || accent.compare(a, b) || variant.compare(a, b) || a.codePointAt(0) - b.codePointAt(0));
const primary = new Array(N).fill(0), secondary = new Array(N).fill(0), tertiary = new Array(N).fill(0);
let p = 0, s = 0, t = 0, previous = null;
for (const c of rest) {
  if (previous === null || base.compare(previous, c) !== 0) { p++; s = 0; t = 0; }
  else if (accent.compare(previous, c) !== 0) { s++; t = 0; }
  else if (variant.compare(previous, c) !== 0) t++;
  const cp = c.codePointAt(0);
  primary[cp] = p; secondary[cp] = s; tertiary[cp] = t;
  previous = c;
}
for (const c of expansions.keys()) primary[c.codePointAt(0)] = 255;
const table = (name, values) => `pub(super) static ${name}: [u8; ${N}] = [\n${Array.from({ length: Math.ceil(N / 24) }, (_, row) => '    ' + values.slice(row * 24, row * 24 + 24).join(', ') + ',').join('\n')}\n];\n`;
console.log(`//! The order of the characters up to U+024F in the root collation of CLDR, which is that of English:
//! what \`Intl.Collator\` and \`localeCompare\` go by. Made by test/cli/format/oracle/sort-imports/icu-table.mjs.

/// The rank of the primary weight. 0: the character is ignored. 255: see [\`EXPANSIONS\`].
${table('PRIMARY', primary)}
/// Among the characters with the same primary weight, the rank of the accent.
${table('SECONDARY', secondary)}
/// Among the characters with the same primary weight and accent, the rank of the case or variant.
${table('TERTIARY', tertiary)}
/// The characters that are sorted as two letters.
pub(super) static EXPANSIONS: [(u16, [u8; 2]); ${expansions.size}] = [
${[...expansions].map(([c, to]) => `    (0x${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}, *b"${to}"),`).join('\n')}
];`);
