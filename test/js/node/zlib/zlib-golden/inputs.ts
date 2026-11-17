// Made-up data to compress. The same arguments always give the same bytes.

/** Whole numbers from 0 up to, and without, the argument. */
export function random(seed: number) {
  let state = (Math.imul(seed, 0x9e3779b1) ^ 0x2545f491) | 1;
  return (below: number) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % below;
  };
}

type Recipe = {
  /** The byte values of what is new. */
  symbols: (next: ReturnType<typeof random>) => number;
  /** So many new bytes in a row, at most. */
  fresh: number;
  /** The shortest and the longest repetition, and how far back it may start. */
  repeat: [min: number, max: number, reach: number];
};

const letters = Buffer.from("eeeeeeeetttttaaaaooooiiinnnssshhrrdlcumwfgypbvk      \n,.");

const recipes = {
  noise: { symbols: next => next(256), fresh: 4096, repeat: [0, 0, 1] },
  /** What takes 9 bits in a fixed block. */
  high: { symbols: next => 144 + next(112), fresh: 4096, repeat: [0, 0, 1] },
  prose: { symbols: next => letters[next(letters.length)], fresh: 9, repeat: [3, 14, 40000] },
  markup: { symbols: next => letters[next(letters.length)], fresh: 24, repeat: [8, 300, 3000] },
  /** Long hash chains. */
  binary: { symbols: next => next(2), fresh: 64, repeat: [3, 40, 600] },
  few: { symbols: next => 97 + next(5), fresh: 30, repeat: [3, 24, 900] },
  runs: { symbols: next => next(256), fresh: 3, repeat: [1, 600, 1] },
  periods: { symbols: next => next(256), fresh: 40, repeat: [2, 700, 40] },
  /** Short matches from far away, which cost about as much as they spare. */
  distant: { symbols: next => next(256), fresh: 2, repeat: [3, 5, 32768] },
  /** Each byte is half as frequent as another. */
  skewed: { symbols: next => Math.clz32(next(0x1000000) + 1) * 7, fresh: 4096, repeat: [0, 0, 1] },
  /** Long matches to choose from, far down the hash chains. */
  echoes: { symbols: next => next(2), fresh: 12, repeat: [28, 90, 32000] },
  zeros: { symbols: () => 0, fresh: 1, repeat: [70000, 70000, 1] },
} satisfies Record<string, Recipe>;

export type Kind = keyof typeof recipes | "mixed" | "unevenBytes" | "unevenDistances";
export const kinds = [...Object.keys(recipes), "mixed", "unevenBytes", "unevenDistances"] as Kind[];

/** The numbers below `count`, shuffled, as often as it takes for an optimal code to get a bit longer with each. */
function uneven(next: ReturnType<typeof random>, count: number) {
  const all: number[] = [];
  for (let n = 0, [times, more] = [1, 2]; n < count; n++, [times, more] = [more, times + more]) {
    for (let i = 0; i < times; i++) all.push(n);
  }
  for (let i = all.length; i > 1;) {
    const other = next(i--);
    [all[i], all[other]] = [all[other], all[i]];
  }
  return all;
}

function fillUnevenBytes(out: Buffer, seed: number) {
  const next = random(seed);
  for (let at = 0; at < out.length;) at += Buffer.from(uneven(next, 16 + next(4))).copy(out, at);
}

function fillUnevenDistances(out: Buffer, seed: number) {
  const next = random(seed);
  let at = Math.min(out.length, 4096);
  fill(out, 0, at, recipes.noise, seed);
  while (at < out.length) {
    for (const n of uneven(next, 17)) {
      // The shortest distances of the symbols from 7 to 23.
      const symbol = 7 + n;
      const from = at - 1 - ((2 + (symbol & 1)) << ((symbol >> 1) - 1));
      out.copyWithin(at, from, from + 5);
      out[at + 5] = next(256);
      out[at + 6] = next(256);
      if ((at += 7) >= out.length) return;
    }
  }
}

function fill(out: Buffer, start: number, end: number, { symbols, fresh, repeat }: Recipe, seed: number) {
  const [next, [min, max, reach]] = [random(seed), repeat];
  for (let at = start; at < end;) {
    for (const until = Math.min(end, at + 1 + next(fresh)); at < until;) out[at++] = symbols(next);
    const length = Math.min(end - at, min + next(max - min + 1));
    if (length === 0) continue;
    const from = at - 1 - next(Math.min(at, reach));
    if (from + length <= at) out.copyWithin(at, from, from + length);
    else out.fill(Buffer.from(out.subarray(from, at)), at, at + length);
    at += length;
  }
}

function fillMixed(out: Buffer, seed: number) {
  const [next, all] = [random(seed), Object.values(recipes)];
  for (let at = 0; at < out.length;) {
    const end = Math.min(out.length, at + 1 + next(1 + (out.length >> 3)));
    fill(out, at, end, all[next(all.length)], next(1 << 30));
    at = end;
  }
}

const made = new Map<string, Buffer<ArrayBuffer>>();

export function input(kind: Kind, length: number, seed = 1) {
  const key = `${kind} ${length} ${seed}`;
  let out = made.get(key);
  if (out) return out;
  made.set(key, (out = Buffer.alloc(length)));
  if (kind === "mixed") fillMixed(out, seed);
  else if (kind === "unevenBytes") fillUnevenBytes(out, seed);
  else if (kind === "unevenDistances") fillUnevenDistances(out, seed);
  else fill(out, 0, length, recipes[kind], seed);
  return out;
}
