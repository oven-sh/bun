// A reader for the parts of profile.proto that Bun writes.
// https://github.com/google/pprof/blob/main/proto/profile.proto
import { gunzipSync } from "node:zlib";

type Field = { field: number; varint?: bigint; bytes?: Uint8Array };

/** The varint at `at.pos`, which it moves past it. */
function readVarint(buf: Uint8Array, at: { pos: number }): bigint {
  let result = 0n;
  for (let shift = 0n; ; shift += 7n) {
    if (at.pos >= buf.length) throw new Error("truncated varint");
    const byte = buf[at.pos++];
    if (shift === 63n && byte > 1) throw new Error("varint overflow");
    result |= BigInt(byte & 0x7f) << shift;
    if (!(byte & 0x80)) return result;
  }
}

function* fields(buf: Uint8Array): Generator<Field> {
  const at = { pos: 0 };
  while (at.pos < buf.length) {
    const key = Number(readVarint(buf, at));
    const field = key >> 3;
    switch (key & 7) {
      case 0:
        yield { field, varint: readVarint(buf, at) };
        break;
      case 2: {
        const length = Number(readVarint(buf, at));
        if (at.pos + length > buf.length) throw new Error("truncated field " + field);
        yield { field, bytes: buf.subarray(at.pos, at.pos + length) };
        at.pos += length;
        break;
      }
      default:
        throw new Error(`unexpected wire type ${key & 7} for field ${field}`);
    }
  }
}

function packed(f: Field): bigint[] {
  if (f.varint !== undefined) return [f.varint];
  const out: bigint[] = [];
  const at = { pos: 0 };
  while (at.pos < f.bytes!.length) out.push(readVarint(f.bytes!, at));
  return out;
}

export type Frame = {
  /** Set for JavaScript frames (and native ones in a symbolized profile). */
  function?: string;
  file?: string;
  line?: number;
  column?: number;
  startLine?: number;
  /** Set for native frames. */
  address?: bigint;
  mapping?: { start: bigint; limit: bigint; offset: bigint; file: string; buildId: string };
};

export type Sample = {
  /** Innermost first. */
  stack: Frame[];
  values: Record<string, number>;
  labels: Record<string, string | number>;
};

export type Profile = {
  stringTable: string[];
  sampleTypes: { type: string; unit: string }[];
  periodType: { type: string; unit: string };
  period: number;
  defaultSampleType: string;
  dropFrames: string;
  comments: string[];
  timeNanos: bigint;
  durationNanos: bigint;
  samples: Sample[];
  mappings: NonNullable<Frame["mapping"]>[];
  /** Sum of each sample type over all samples. */
  totals: Record<string, number>;
};

export function decode(gzipped: Uint8Array): Profile {
  if (gzipped[0] !== 0x1f || gzipped[1] !== 0x8b) throw new Error("not gzip");
  const buf = gunzipSync(gzipped);

  const stringTable: string[] = [];
  const raw = {
    sampleTypes: [] as [bigint, bigint][],
    samples: [] as { locations: bigint[]; values: bigint[]; labels: [bigint, bigint, bigint][] }[],
    mappings: new Map<bigint, { start: bigint; limit: bigint; offset: bigint; file: bigint; buildId: bigint }>(),
    locations: new Map<bigint, { mapping: bigint; address: bigint; lines: [bigint, bigint, bigint][] }>(),
    functions: new Map<bigint, { name: bigint; file: bigint; startLine: bigint }>(),
    periodType: [0n, 0n] as [bigint, bigint],
    period: 0n,
    defaultSampleType: 0n,
    dropFrames: 0n,
    comments: [] as bigint[],
    timeNanos: 0n,
    durationNanos: 0n,
  };
  const valueType = (bytes: Uint8Array): [bigint, bigint] => {
    const out: [bigint, bigint] = [0n, 0n];
    for (const f of fields(bytes)) if (f.field === 1 || f.field === 2) out[f.field - 1] = f.varint!;
    return out;
  };
  const decoder = new TextDecoder("utf-8", { fatal: true });

  for (const f of fields(buf)) {
    switch (f.field) {
      case 1:
        raw.sampleTypes.push(valueType(f.bytes!));
        break;
      case 2: {
        const sample = { locations: [] as bigint[], values: [] as bigint[], labels: [] as [bigint, bigint, bigint][] };
        for (const s of fields(f.bytes!)) {
          if (s.field === 1) sample.locations.push(...packed(s));
          else if (s.field === 2) sample.values.push(...packed(s));
          else if (s.field === 3) {
            const label: [bigint, bigint, bigint] = [0n, 0n, 0n];
            for (const l of fields(s.bytes!)) if (l.field >= 1 && l.field <= 3) label[l.field - 1] = l.varint!;
            sample.labels.push(label);
          }
        }
        raw.samples.push(sample);
        break;
      }
      case 3: {
        const m = { id: 0n, start: 0n, limit: 0n, offset: 0n, file: 0n, buildId: 0n };
        for (const s of fields(f.bytes!)) {
          const key = ([, "id", "start", "limit", "offset", "file", "buildId"] as const)[s.field];
          if (key) m[key] = s.varint!;
        }
        raw.mappings.set(m.id, m);
        break;
      }
      case 4: {
        const l = { id: 0n, mapping: 0n, address: 0n, lines: [] as [bigint, bigint, bigint][] };
        for (const s of fields(f.bytes!)) {
          if (s.field === 1) l.id = s.varint!;
          else if (s.field === 2) l.mapping = s.varint!;
          else if (s.field === 3) l.address = s.varint!;
          else if (s.field === 4) {
            const line: [bigint, bigint, bigint] = [0n, 0n, 0n];
            for (const x of fields(s.bytes!)) if (x.field >= 1 && x.field <= 3) line[x.field - 1] = x.varint!;
            l.lines.push(line);
          }
        }
        if (raw.locations.has(l.id)) throw new Error("duplicate location id " + l.id);
        raw.locations.set(l.id, l);
        break;
      }
      case 5: {
        const fn = { id: 0n, name: 0n, file: 0n, startLine: 0n };
        for (const s of fields(f.bytes!)) {
          if (s.field === 1) fn.id = s.varint!;
          else if (s.field === 2) fn.name = s.varint!;
          else if (s.field === 4) fn.file = s.varint!;
          else if (s.field === 5) fn.startLine = s.varint!;
        }
        if (raw.functions.has(fn.id)) throw new Error("duplicate function id " + fn.id);
        raw.functions.set(fn.id, fn);
        break;
      }
      case 6:
        stringTable.push(decoder.decode(f.bytes!));
        break;
      case 7:
        raw.dropFrames = f.varint!;
        break;
      case 9:
        raw.timeNanos = f.varint!;
        break;
      case 10:
        raw.durationNanos = f.varint!;
        break;
      case 11:
        raw.periodType = valueType(f.bytes!);
        break;
      case 12:
        raw.period = f.varint!;
        break;
      case 13:
        raw.comments.push(...packed(f));
        break;
      case 14:
        raw.defaultSampleType = f.varint!;
        break;
    }
  }

  const str = (index: bigint) => {
    const value = stringTable[Number(index)];
    if (value === undefined) throw new Error("string index out of range: " + index);
    return value;
  };
  const sampleTypes = raw.sampleTypes.map(([type, unit]) => ({ type: str(type), unit: str(unit) }));
  const mappings = new Map(
    [...raw.mappings].map(([id, m]) => [
      id,
      { start: m.start, limit: m.limit, offset: m.offset, file: str(m.file), buildId: str(m.buildId) },
    ]),
  );
  const totals: Record<string, number> = Object.fromEntries(sampleTypes.map(t => [t.type, 0]));

  const samples = raw.samples.map(sample => {
    if (sample.values.length !== sampleTypes.length) throw new Error("a sample has the wrong number of values");
    const stack: Frame[] = [];
    for (const id of sample.locations) {
      const location = raw.locations.get(id);
      if (!location) throw new Error("a sample refers to a missing location " + id);
      if (location.lines.length === 0) {
        const mapping = mappings.get(location.mapping);
        if (location.mapping !== 0n && !mapping) throw new Error("a location refers to a missing mapping");
        if (mapping && (location.address < mapping.start || location.address >= mapping.limit))
          throw new Error("a location's address is outside its mapping");
        stack.push({ address: location.address, mapping });
      }
      for (const [functionId, line, column] of location.lines) {
        const fn = raw.functions.get(functionId);
        if (!fn) throw new Error("a line refers to a missing function " + functionId);
        stack.push({
          function: str(fn.name),
          file: str(fn.file),
          line: Number(line),
          column: Number(column),
          startLine: Number(fn.startLine),
        });
      }
    }
    const values: Record<string, number> = {};
    sample.values.forEach((value, i) => {
      values[sampleTypes[i].type] = Number(value);
      totals[sampleTypes[i].type] += Number(value);
    });
    const labels: Record<string, string | number> = {};
    for (const [key, s, n] of sample.labels) labels[str(key)] = s !== 0n ? str(s) : Number(n);
    return { stack, values, labels };
  });

  return {
    stringTable,
    sampleTypes,
    periodType: { type: str(raw.periodType[0]), unit: str(raw.periodType[1]) },
    period: Number(raw.period),
    defaultSampleType: str(raw.defaultSampleType),
    dropFrames: str(raw.dropFrames),
    comments: raw.comments.map(str),
    timeNanos: raw.timeNanos,
    durationNanos: raw.durationNanos,
    samples,
    mappings: [...mappings.values()],
    totals,
  };
}

/** Sum of each sample type over the samples whose stack has a frame that `matches`. */
export function totalsWhere(profile: Profile, matches: (frame: Frame) => boolean): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(profile.sampleTypes.map(t => [t.type, 0]));
  for (const sample of profile.samples) {
    if (!sample.stack.some(matches)) continue;
    for (const [type, value] of Object.entries(sample.values)) out[type] += value;
  }
  return out;
}
