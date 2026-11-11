export namespace JSX {
  type Element = string;
  interface IntrinsicElements {
    [name: string]: any;
  }
  interface ElementChildrenAttribute {
    children: {};
  }
}
export function jsx(type: any, props: any): string;
export const jsxs: typeof jsx;
export const jsxDEV: typeof jsx;
export const Fragment: string;
