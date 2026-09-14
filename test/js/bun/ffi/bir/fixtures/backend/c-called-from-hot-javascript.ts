import { ptr } from "bun:ffi";
import * as c from "./c-called-from-hot-javascript.c";

// Two million calls each, so that the loops reach the last tier; with the optimizing tiers switched off (C itself
// needs the JIT, so there is no running this with none) they stay in the first, where a tenth of that is plenty.
const rounds = process.env.BUN_JSC_useDFGJIT === "0" ? 200_000 : 2_000_000;
const summed = 20_000; // the part of every run that goes into the totals printed, the same in every mode

function tooBig(x: number) {
  x = (Math.imul(x, 3) + (x >>> 1) + 0) >>> 0;
  x = (x ^ (x << 1)) >>> 0;
  x = (Math.imul(x, 5) + (x >>> 2) + 427799) >>> 0;
  x = (x ^ (x << 2)) >>> 0;
  x = (Math.imul(x, 7) + (x >>> 3) + 855598) >>> 0;
  x = (x ^ (x << 3)) >>> 0;
  x = (Math.imul(x, 9) + (x >>> 4) + 283394) >>> 0;
  x = (x ^ (x << 4)) >>> 0;
  x = (Math.imul(x, 11) + (x >>> 5) + 711193) >>> 0;
  x = (x ^ (x << 5)) >>> 0;
  x = (Math.imul(x, 3) + (x >>> 6) + 138989) >>> 0;
  x = (x ^ (x << 6)) >>> 0;
  x = (Math.imul(x, 5) + (x >>> 7) + 566788) >>> 0;
  x = (x ^ (x << 7)) >>> 0;
  x = (Math.imul(x, 7) + (x >>> 1) + 994587) >>> 0;
  x = (x ^ (x << 8)) >>> 0;
  x = (Math.imul(x, 9) + (x >>> 2) + 422383) >>> 0;
  x = (x ^ (x << 9)) >>> 0;
  x = (Math.imul(x, 11) + (x >>> 3) + 850182) >>> 0;
  x = (x ^ (x << 10)) >>> 0;
  x = (Math.imul(x, 3) + (x >>> 4) + 277978) >>> 0;
  x = (x ^ (x << 11)) >>> 0;
  x = (Math.imul(x, 5) + (x >>> 5) + 705777) >>> 0;
  x = (x ^ (x << 1)) >>> 0;
  x = (Math.imul(x, 7) + (x >>> 6) + 133573) >>> 0;
  x = (x ^ (x << 2)) >>> 0;
  x = (Math.imul(x, 9) + (x >>> 7) + 561372) >>> 0;
  x = (x ^ (x << 3)) >>> 0;
  x = (Math.imul(x, 11) + (x >>> 1) + 989171) >>> 0;
  x = (x ^ (x << 4)) >>> 0;
  x = (Math.imul(x, 3) + (x >>> 2) + 416967) >>> 0;
  x = (x ^ (x << 5)) >>> 0;
  x = (Math.imul(x, 5) + (x >>> 3) + 844766) >>> 0;
  x = (x ^ (x << 6)) >>> 0;
  x = (Math.imul(x, 7) + (x >>> 4) + 272562) >>> 0;
  x = (x ^ (x << 7)) >>> 0;
  x = (Math.imul(x, 9) + (x >>> 5) + 700361) >>> 0;
  x = (x ^ (x << 8)) >>> 0;
  x = (Math.imul(x, 11) + (x >>> 6) + 128157) >>> 0;
  x = (x ^ (x << 9)) >>> 0;
  x = (Math.imul(x, 3) + (x >>> 7) + 555956) >>> 0;
  x = (x ^ (x << 10)) >>> 0;
  x = (Math.imul(x, 5) + (x >>> 1) + 983755) >>> 0;
  x = (x ^ (x << 11)) >>> 0;
  x = (Math.imul(x, 7) + (x >>> 2) + 411551) >>> 0;
  x = (x ^ (x << 1)) >>> 0;
  x = (Math.imul(x, 9) + (x >>> 3) + 839350) >>> 0;
  x = (x ^ (x << 2)) >>> 0;
  x = (Math.imul(x, 11) + (x >>> 4) + 267146) >>> 0;
  x = (x ^ (x << 3)) >>> 0;
  x = (Math.imul(x, 3) + (x >>> 5) + 694945) >>> 0;
  x = (x ^ (x << 4)) >>> 0;
  x = (Math.imul(x, 5) + (x >>> 6) + 122741) >>> 0;
  x = (x ^ (x << 5)) >>> 0;
  x = (Math.imul(x, 7) + (x >>> 7) + 550540) >>> 0;
  x = (x ^ (x << 6)) >>> 0;
  x = (Math.imul(x, 9) + (x >>> 1) + 978339) >>> 0;
  x = (x ^ (x << 7)) >>> 0;
  x = (Math.imul(x, 11) + (x >>> 2) + 406135) >>> 0;
  x = (x ^ (x << 8)) >>> 0;
  x = (Math.imul(x, 3) + (x >>> 3) + 833934) >>> 0;
  x = (x ^ (x << 9)) >>> 0;
  x = (Math.imul(x, 5) + (x >>> 4) + 261730) >>> 0;
  x = (x ^ (x << 10)) >>> 0;
  x = (Math.imul(x, 7) + (x >>> 5) + 689529) >>> 0;
  x = (x ^ (x << 11)) >>> 0;
  x = (Math.imul(x, 9) + (x >>> 6) + 117325) >>> 0;
  x = (x ^ (x << 1)) >>> 0;
  x = (Math.imul(x, 11) + (x >>> 7) + 545124) >>> 0;
  x = (x ^ (x << 2)) >>> 0;
  x = (Math.imul(x, 3) + (x >>> 1) + 972923) >>> 0;
  x = (x ^ (x << 3)) >>> 0;
  x = (Math.imul(x, 5) + (x >>> 2) + 400719) >>> 0;
  x = (x ^ (x << 4)) >>> 0;
  x = (Math.imul(x, 7) + (x >>> 3) + 828518) >>> 0;
  x = (x ^ (x << 5)) >>> 0;
  x = (Math.imul(x, 9) + (x >>> 4) + 256314) >>> 0;
  x = (x ^ (x << 6)) >>> 0;
  x = (Math.imul(x, 11) + (x >>> 5) + 684113) >>> 0;
  x = (x ^ (x << 7)) >>> 0;
  x = (Math.imul(x, 3) + (x >>> 6) + 111909) >>> 0;
  x = (x ^ (x << 8)) >>> 0;
  x = (Math.imul(x, 5) + (x >>> 7) + 539708) >>> 0;
  x = (x ^ (x << 9)) >>> 0;
  x = (Math.imul(x, 7) + (x >>> 1) + 967507) >>> 0;
  x = (x ^ (x << 10)) >>> 0;
  x = (Math.imul(x, 9) + (x >>> 2) + 395303) >>> 0;
  x = (x ^ (x << 11)) >>> 0;
  x = (Math.imul(x, 11) + (x >>> 3) + 823102) >>> 0;
  x = (x ^ (x << 1)) >>> 0;
  x = (Math.imul(x, 3) + (x >>> 4) + 250898) >>> 0;
  x = (x ^ (x << 2)) >>> 0;
  x = (Math.imul(x, 5) + (x >>> 5) + 678697) >>> 0;
  x = (x ^ (x << 3)) >>> 0;
  x = (Math.imul(x, 7) + (x >>> 6) + 106493) >>> 0;
  x = (x ^ (x << 4)) >>> 0;
  x = (Math.imul(x, 9) + (x >>> 7) + 534292) >>> 0;
  x = (x ^ (x << 5)) >>> 0;
  x = (Math.imul(x, 11) + (x >>> 1) + 962091) >>> 0;
  x = (x ^ (x << 6)) >>> 0;
  x = (Math.imul(x, 3) + (x >>> 2) + 389887) >>> 0;
  x = (x ^ (x << 7)) >>> 0;
  x = (Math.imul(x, 5) + (x >>> 3) + 817686) >>> 0;
  x = (x ^ (x << 8)) >>> 0;
  x = (Math.imul(x, 7) + (x >>> 4) + 245482) >>> 0;
  x = (x ^ (x << 9)) >>> 0;
  x = (Math.imul(x, 9) + (x >>> 5) + 673281) >>> 0;
  x = (x ^ (x << 10)) >>> 0;
  x = (Math.imul(x, 11) + (x >>> 6) + 101077) >>> 0;
  x = (x ^ (x << 11)) >>> 0;
  x = (Math.imul(x, 3) + (x >>> 7) + 528876) >>> 0;
  x = (x ^ (x << 1)) >>> 0;
  x = (Math.imul(x, 5) + (x >>> 1) + 956675) >>> 0;
  x = (x ^ (x << 2)) >>> 0;
  x = (Math.imul(x, 7) + (x >>> 2) + 384471) >>> 0;
  x = (x ^ (x << 3)) >>> 0;
  x = (Math.imul(x, 9) + (x >>> 3) + 812270) >>> 0;
  x = (x ^ (x << 4)) >>> 0;
  x = (Math.imul(x, 11) + (x >>> 4) + 240066) >>> 0;
  x = (x ^ (x << 5)) >>> 0;
  x = (Math.imul(x, 3) + (x >>> 5) + 667865) >>> 0;
  x = (x ^ (x << 6)) >>> 0;
  x = (Math.imul(x, 5) + (x >>> 6) + 95661) >>> 0;
  x = (x ^ (x << 7)) >>> 0;
  x = (Math.imul(x, 7) + (x >>> 7) + 523460) >>> 0;
  x = (x ^ (x << 8)) >>> 0;
  x = (Math.imul(x, 9) + (x >>> 1) + 951259) >>> 0;
  x = (x ^ (x << 9)) >>> 0;
  x = (Math.imul(x, 11) + (x >>> 2) + 379055) >>> 0;
  x = (x ^ (x << 10)) >>> 0;
  x = (Math.imul(x, 3) + (x >>> 3) + 806854) >>> 0;
  x = (x ^ (x << 11)) >>> 0;
  x = (Math.imul(x, 5) + (x >>> 4) + 234650) >>> 0;
  x = (x ^ (x << 1)) >>> 0;
  x = (Math.imul(x, 7) + (x >>> 5) + 662449) >>> 0;
  x = (x ^ (x << 2)) >>> 0;
  x = (Math.imul(x, 9) + (x >>> 6) + 90245) >>> 0;
  x = (x ^ (x << 3)) >>> 0;
  x = (Math.imul(x, 11) + (x >>> 7) + 518044) >>> 0;
  x = (x ^ (x << 4)) >>> 0;
  x = (Math.imul(x, 3) + (x >>> 1) + 945843) >>> 0;
  x = (x ^ (x << 5)) >>> 0;
  x = (Math.imul(x, 5) + (x >>> 2) + 373639) >>> 0;
  x = (x ^ (x << 6)) >>> 0;
  x = (Math.imul(x, 7) + (x >>> 3) + 801438) >>> 0;
  x = (x ^ (x << 7)) >>> 0;
  x = (Math.imul(x, 9) + (x >>> 4) + 229234) >>> 0;
  x = (x ^ (x << 8)) >>> 0;
  x = (Math.imul(x, 11) + (x >>> 5) + 657033) >>> 0;
  x = (x ^ (x << 9)) >>> 0;
  x = (Math.imul(x, 3) + (x >>> 6) + 84829) >>> 0;
  x = (x ^ (x << 10)) >>> 0;
  x = (Math.imul(x, 5) + (x >>> 7) + 512628) >>> 0;
  x = (x ^ (x << 11)) >>> 0;
  x = (Math.imul(x, 7) + (x >>> 1) + 940427) >>> 0;
  x = (x ^ (x << 1)) >>> 0;
  x = (Math.imul(x, 9) + (x >>> 2) + 368223) >>> 0;
  x = (x ^ (x << 2)) >>> 0;
  x = (Math.imul(x, 11) + (x >>> 3) + 796022) >>> 0;
  x = (x ^ (x << 3)) >>> 0;
  return x;
}
function collatz(n: number) {
  let steps = 0;
  while (n !== 1 && steps < 200) {
    n = n % 2 ? 3 * n + 1 : n / 2;
    // C computes in 32 bits.
    n = n >>> 0;
    steps++;
  }
  return steps;
}
const helper = (x: number) => x * x - 1;

let line: string[] = [];
function report(name: string, wrong: number, total: number | bigint) {
  line.push(`${name} ${wrong} ${total}`);
}
const specials = [
  0,
  -0,
  1,
  -1,
  0.1,
  NaN,
  Infinity,
  -Infinity,
  1e308,
  5e-324,
  2 ** 53,
  -(2 ** 31),
  2 ** 31 - 1,
  2 ** 32,
];

{
  let wrong = 0,
    total = 0;
  for (let i = 0; i < rounds; i++) {
    const a = (i * 2654435761) | 0,
      b = (i * 40503 + 2 ** 31 - 5) | 0;
    const got = c.add_wrapping(a, b);
    if (got !== ((a + b) | 0)) wrong++;
    if (i < summed) total = (total + got) | 0;
  }
  report("add_wrapping", wrong, total);
}
{
  let wrong = 0,
    total = 0;
  for (let i = 0; i < rounds; i++) {
    const a = (i * 2246822519) >>> 0;
    const got = c.above_two_to_the_31(a);
    if (got !== (a + 0x80000000) >>> 0) wrong++;
    if (i < summed) total = (total + got) % 4294967296;
  }
  report("above_two_to_the_31", wrong, total);
}
{
  let wrong = 0,
    total = 0;
  for (let i = 0; i < rounds; i++) {
    const a = i % 97 === 0 ? specials[(i / 97) % specials.length | 0] : i * 0.37 - 1000,
      b = i % 89 === 0 ? specials[(i / 89) % specials.length | 0] : (i % 1000) - 499.5;
    const got = c.real_arithmetic(a, b),
      want = a / b - b;
    if (!Object.is(got, want)) wrong++;
    const through = c.passes_through(a);
    if (!Object.is(through, a)) wrong++;
    if (i < summed && Math.abs(got) < 1e100) total += got;
  }
  report("real_arithmetic", wrong, total);
}
{
  let wrong = 0,
    total = 0;
  for (let i = 0; i < rounds; i++) {
    const a = i * 0.001 + 0.1,
      b = 16777217 - i;
    const got = c.single_precision(a, b),
      want = Math.fround(Math.fround(Math.fround(a) * Math.fround(b)) + Math.fround(0.1));
    if (got !== want) wrong++;
    if (i < summed) total += got;
  }
  report("single_precision", wrong, total);
}
{
  let wrong = 0,
    total = 0;
  for (let i = 0; i < rounds; i++) {
    const of = i % 13;
    const got = c.is_a_multiple(i, of);
    if (got !== (of !== 0 && i % of === 0)) wrong++;
    if (i < summed && got) total++;
  }
  report("is_a_multiple", wrong, total);
}
{
  let wrong = 0,
    total = 0;
  for (let i = 0; i < rounds; i++) {
    const got8 = c.narrows_to_8(i, i * 3),
      got16 = c.narrows_to_16(i * 5, i * 7);
    if (got8 !== ((i << 24) >> 24) * 1000 + ((i * 3) & 0xff)) wrong++;
    if (got16 !== (((i * 5) << 16) >> 16) * 7 + ((i * 7) & 0xffff)) wrong++;
    if (i < summed) total = (total + got8 + got16) | 0;
  }
  report("narrowing", wrong, total);
}
{
  let wrong = 0,
    total = 0n;
  const limits = [0n, 1n, -1n, 2n ** 63n - 1n, -(2n ** 63n), 2n ** 62n, 123456789012345678n];
  for (let i = 0; i < rounds; i++) {
    const a = limits[i % limits.length],
      b = limits[(i >> 3) % limits.length] + BigInt(i);
    const got = c.wide_sum(a, BigInt.asIntN(64, b));
    if (got !== BigInt.asIntN(64, a + b)) wrong++;
    const flipped = c.wide_unsigned(BigInt.asUintN(64, b));
    if (flipped !== BigInt.asUintN(64, ~b)) wrong++;
    if (i < summed) total = BigInt.asIntN(64, total + got + BigInt.asIntN(64, flipped));
  }
  report("wide", wrong, total);
}
{
  let wrong = 0,
    total = 0;
  const bytes = new Uint8Array(64),
    values = new Int32Array(256);
  for (let i = 0; i < 256; i++) values[i] = i * i - 100;
  const base = ptr(bytes);
  for (let i = 0; i < rounds; i++) {
    const offset = i & 63;
    if (c.address_of(bytes, offset) !== base + offset) wrong++;
    const got = c.reads_memory(values, i & 255);
    if (got !== values[i & 255]) wrong++;
    if (i < summed) total += got;
  }
  if (c.address_of(null, 0) !== null) wrong++;
  report("memory", wrong, total);
}
{
  let wrong = 0,
    total = 0;
  for (let i = 0; i < rounds; i++) {
    const n = (i % 5000) + 1;
    const got = c.loop_and_branch(n);
    if (got !== collatz(n)) wrong++;
    if (i < summed) total += got;
  }
  report("loop_and_branch", wrong, total);
}
{
  // State in C persists from call to call, whichever tier makes the call.
  let wrong = 0;
  for (let i = 0; i < rounds; i++) {
    if (c.counts_calls(i) !== BigInt(i + 1)) wrong++;
    if ((i & 1023) === 0 && c.last_seen() !== i) wrong++;
  }
  report("state", wrong, c.last_seen() === rounds - 1 ? 1 : 0);
}
{
  let wrong = 0,
    total = 0;
  for (let i = 0; i < rounds; i++) {
    const got = c.calls_another(i);
    if (got !== helper(i & 0xfff) + helper((i >> 3) & 0xff)) wrong++;
    const next = c.traps_if_negative(i);
    if (next !== i + 1) wrong++;
    if (i < summed) total = (total + got) | 0;
  }
  report("calls_another", wrong, total);
}
{
  let wrong = 0,
    total = 0;
  for (let i = 0; i < rounds; i++) {
    const x = (i * 2654435761) >>> 0;
    const got = c.too_big_to_inline(x);
    if (got !== tooBig(x)) wrong++;
    if (i < summed) total = (total + got) % 4294967296;
  }
  report("too_big_to_inline", wrong, total);
}
console.log(line.join("\n"));
