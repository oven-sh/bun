declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }

export function Fragment(props: { children: any[] }): string {
  return "fragment(" + props.children.join() + ")";
}
export function createElement(type: any, props: any, ...children: any[]): any {
  return typeof type === "function" ? type({ ...props, children }) : type + "(" + children.join() + ")";
}
export function useState() {
  return "unused";
}
