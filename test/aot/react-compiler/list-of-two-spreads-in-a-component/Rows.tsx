export function Rows({ first, second }: { first: number[]; second: number[] }) {
  const all = [...first, ...second];
  const framed = [0, ...first, ...second, 9];
  return <p title={String(all.length)}>{[all, framed].join(" | ")}</p>;
}
