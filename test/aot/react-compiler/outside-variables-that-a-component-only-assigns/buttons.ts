export const handlers: (() => void)[] = [];
export function Button(props: { onClick: () => void; children?: unknown }): string {
  handlers.push(props.onClick);
  return "<button>" + props.children + "</button>";
}
