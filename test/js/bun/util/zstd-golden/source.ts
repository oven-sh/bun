// Made-up data to compress, from a seed and a few numbers.

export type Source = {
  seed: number;
  /** One after the other. The first number picks a function of `makers`, the second is the length. */
  parts: number[][];
  /** So many bytes from the start are not input but the content of the dictionary. */
  shared?: number;
  /** What is in front of that content in a dictionary with entropy tables, in base64. */
  tables?: string;
};

class Writer {
  position = 0;
  constructor(
    readonly bytes: Buffer,
    private state: number,
  ) {}

  /** 31 bits. */
  next() {
    let state = this.state;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (this.state = state) >>> 1;
  }

  /** True `n` times out of 256. */
  chance(n: number) {
    return this.next() >> 23 < n;
  }

  /** As likely to have few bits as many. */
  upTo(max: number) {
    const bits = this.next() % (33 - Math.clz32(max));
    return bits && Math.min(max, (1 << (bits - 1)) + (this.next() % (1 << (bits - 1))));
  }

  copy(distance: number, length: number) {
    const from = this.position - distance;
    const end = this.position + length;
    // A call of a native function takes long in a debug build.
    if (length < 256) {
      for (; this.position < end; this.position++) this.bytes[this.position] = this.bytes[this.position - distance];
    }
    // What has been copied repeats with the same period.
    while (this.position < end) {
      const n = Math.min(this.position - from, end - this.position);
      this.bytes.copyWithin(this.position, from, from + n);
      this.position += n;
    }
  }
}

function sequences(
  out: Writer,
  end: number,
  [more, repeat, minMatch, matchSpan, minLiterals, literalSpan, near, far, alphabet, skew, growth]: number[],
) {
  const first = out.next() & 255;
  const step = (out.next() & 254) | 1;
  const symbols = new Uint8Array(8192);
  for (let i = 0, used = 0; i < alphabet; i++) {
    const left = 8192 - used;
    const others = alphabet - i - 1;
    const even = Math.floor(left / (others + 1));
    const share = others ? Math.min(even + (((left - even) * skew) >> 8), left - others) : left;
    for (const stop = used + share; used < stop; used++) symbols[used] = first + i * step;
  }

  const recent = [1, 4, 8, 0];
  while (out.position < end) {
    let literals = minLiterals + (out.chance(more) ? out.upTo(literalSpan) : 0);
    if (!out.position || !minMatch) literals ||= 1;
    for (const stop = Math.min(end, out.position + literals); out.position < stop;) {
      out.bytes[out.position++] = symbols[out.next() >> 18];
    }
    if (!minMatch) continue;

    const length = minMatch + out.upTo(matchSpan);
    minMatch += growth;
    let distance: number;
    if (out.chance(repeat)) distance = recent[out.next() & 3];
    else if (out.chance(128)) distance = near + (out.next() % (far - near + 1));
    else distance = near + out.upTo(far - near);
    distance = Math.min(Math.max(distance, 1), out.position);
    recent[2] = recent[1];
    recent[1] = recent[0];
    recent[0] = distance;
    recent[3] = distance - 1;
    out.copy(distance, Math.min(length, end - out.position));
  }
}

function match(out: Writer, end: number, [distance]: number[]) {
  out.copy(Math.min(distance, out.position), end - out.position);
}

/** The bytes below `alike` once each and `alike` itself `last` times, over and over in another order. */
function shuffles(out: Writer, end: number, [alike, last]: number[]) {
  const pool = Uint8Array.from({ length: alike + last }, (_, i) => Math.min(i, alike));
  while (out.position < end) {
    for (let i = pool.length - 1; i > 0; i--) {
      const j = out.next() % (i + 1);
      const other = pool[j];
      pool[j] = pool[i];
      pool[i] = other;
    }
    for (let i = 0; i < pool.length && out.position < end; i++) out.bytes[out.position++] = pool[i];
  }
}

const makers = [sequences, match, shuffles];

export function make({ seed, parts, shared = 0, tables = "" }: Source) {
  const out = new Writer(Buffer.alloc(parts.reduce((sum, part) => sum + part[1], 0)), seed);
  for (const [maker, length, ...rest] of parts) makers[maker](out, out.position + length, rest);
  return {
    input: out.bytes.subarray(shared),
    dictionary: Buffer.concat([Buffer.from(tables, "base64"), out.bytes.subarray(0, shared)]),
  };
}
