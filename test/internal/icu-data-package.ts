/** The index of the item of the first file. */
export const firstFile = 3;

const words = (...values: number[]) => Buffer.from(new Uint16Array(values).buffer);

function directoryOf(names: string[], firstName: number, rest: (index: number) => number[]) {
  let at = firstName;
  const entries = names.flatMap((name, index) => [(at += name.length + 1) - name.length - 1, ...rest(index)]);
  return [words(names.length, ...entries), Buffer.from(names.map(name => name + "\0").join(""), "latin1")] as const;
}

/** In the format of src/icu/format/package.rs. `trees` has a bit for each tree. The seven cells of a unit have a byte each. */
export function packageOf(
  files: [path: string, size: number][],
  locales: [name: string, unit: number, trees: number][] = [],
): Buffer {
  const paths = files.map(([path]) => path);
  const directory = directoryOf(paths, 2 + files.length * 8, index => [firstFile + index, 0, 0]);
  const [entries, keys] = directoryOf(
    locales.map(([name]) => name),
    0,
    index => [0, locales[index]![2] | (index << 13), (index >> 3) | (locales[index]![1] << 7)],
  );
  const aligned = [keys, entries, Buffer.concat(directory), ...files.map(([, size]) => Buffer.alloc(size, 0xaa))];
  const units = Math.max(0, ...locales.map(([, unit]) => unit + 1));
  const items = [
    ...aligned.map(item => Buffer.concat([item], Math.ceil(item.length / 4) * 4)),
    ...Array.from({ length: units * 7 }, () => Buffer.alloc(1, 0xbb)),
  ];
  let end = 16 + items.length * 4;
  const offsets = new Uint32Array([items.length, end, ...items.map(item => (end += item.length))]);
  return Buffer.concat([Buffer.from("BICU"), words(aligned.length, units), Buffer.from(offsets.buffer), ...items]);
}
