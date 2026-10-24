function flatten(children: unknown): string {
  return Array.isArray(children) ? children.map(flatten).join("") : children == null ? "" : String(children);
}

function build(type: any, props: Record<string, unknown>): string {
  return typeof type === "function" ? type(props) : "<" + type + ">" + flatten(props.children) + "</" + type + ">";
}

export function Fragment(props: { children?: unknown }): string {
  return "{" + flatten(props.children) + "}";
}

export function jsx(type: any, props: Record<string, unknown>): string {
  return build(type, props);
}

export function jsxs(type: any, props: Record<string, unknown>): string {
  return build(type, props);
}

export function jsxDEV(type: any, props: Record<string, unknown>): string {
  return build(type, props);
}

export namespace JSX {
  export type Element = string;
  export interface IntrinsicElements { [name: string]: any }
  export interface ElementChildrenAttribute { children: {} }
}
