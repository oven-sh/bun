export function jsx(type: string, props: Record<string, unknown>, key?: string): string {
  return "jsx " + type + " " + JSON.stringify(props) + " " + key;
}
export const jsxs = jsx;
export const jsxDEV = jsx;
export const Fragment = "fragment";
export namespace JSX {
  export type Element = string;
  export interface IntrinsicElements { [name: string]: any }
}
