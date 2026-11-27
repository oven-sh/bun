export const callbacks: ((index: number) => void)[] = [];
export function List(props: { onSelect: (index: number) => void; onKey?: (index: number) => void; children?: unknown }): string {
  callbacks.push(props.onSelect);
  if (props.onKey) callbacks.push(props.onKey);
  return "<list>" + [props.children].flat(2).join("") + "</list>";
}
List.Item = (props: { label: string }): string => "<item>" + props.label + "</item>";
export function useStore<T>(store: T): T {
  return store;
}
export function normalize<T>(value: T): T {
  return value;
}
