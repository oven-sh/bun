// @ts-nocheck

// Declare a minimally reproducible JSX namespace for testing;
// ensures that no dependencies are required for this test.
export interface JSXIntrinsicElements {
  "ns:foo": {
    "tag"?: boolean;
    "ns:bar"?: string;
    "ns:bar42"?: string;
    "ns:bar42bar"?: string;
    "ns42:bar"?: string;
  };
}

// Minimal JSX element implementation.
export class Element<T, P, C> {
  constructor(
    public readonly tag: T,
    public readonly props: P,
    public readonly children: C,
  ) { }
}

export interface JsxElement extends Element<unknown, unknown, unknown> { }

// JSX factory function used when compiling JSX with `jsx` pragma.
// This is what the JSX transpiles to.
export function jsx<T, P, C extends unknown[]>(
  tag: T,
  props: P,
  ...children: C
) {
  return new Element(tag, props, children);
}

// Define the JSX namespace itself so TypeScript can resolve JSX
// types correctly.
export namespace jsx.JSX {
  export interface Element extends JsxElement { }
  export type IntrinsicElements = JSXIntrinsicElements;
}

// Examples of namespaced JSX attributes
export const nsExample1 = <ns:foo tag ns:bar="baz" />;
export const nsExample2 = <ns:foo tag={false} ns:bar42="baz" />;
export const nsExample3 = <ns:foo ns:bar42bar="baz" />;
export const nsExample4 = <ns:foo ns42:bar="baz" />;
