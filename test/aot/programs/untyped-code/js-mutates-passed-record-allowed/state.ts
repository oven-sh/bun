export interface Counter {
  count: number;
  label: string;
}
export interface Holder {
  count: number;
  label: string | null;
  inner: { n: number };
  list: number[];
  note?: string;
}
export type Closed = { open: false; items: string[] };
export type Open = { open: true; items: string[]; at: number };
export type State = Closed | Open;

export function makeCounter(): Counter {
  return { count: 1, label: "one" };
}
export function makeHolder(): Holder {
  return { count: 1, label: null, inner: { n: 5 }, list: [1, 2] };
}
export function makeState(): State {
  return { open: false, items: [] };
}
export function showCounter(counter: Counter): string {
  return counter.label + " " + (counter.count + 1);
}
export function showHolder(holder: Holder): string {
  return (
    String(holder.label) +
    " " +
    (holder.count + 1) +
    " " +
    holder.inner.n +
    " " +
    holder.list.join("+") +
    " " +
    String(holder.note)
  );
}
export function showState(state: State): string {
  return (state.open ? "open " + state.at : "closed") + " " + state.items.length;
}
