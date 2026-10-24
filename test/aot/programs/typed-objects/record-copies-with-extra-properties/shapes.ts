export type Props = { id: number; label: string; size?: number; on?: boolean };
export function makeProps(id: number): Props {
  return { id, label: "x" };
}
export function copyOf(props: Props): Props {
  return { ...props };
}
export function copyWithSize(props: Props): Props {
  return { ...props, size: 4 };
}
export function copyBehindSize(props: Props): Props {
  return { size: -1, ...props };
}
export function setSize(props: Props, size: number): void {
  props.size = size;
}
export function setOn(props: Props, on: boolean): void {
  props.on = on;
}
export type Pair = { first: unknown; second: unknown };
export function makePair(first: unknown, second: unknown): Pair {
  return { first, second };
}
export function copyOfPair(pair: Pair): Pair {
  return { ...pair };
}
