declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }

export function Group(props: { children: any[] }): string {
  return "group(" + props.children.join("+") + ")";
}

export function make(tag: any, props: any, ...children: any[]): any {
  return typeof tag === "function" ? tag({ ...props, children }) : tag + "(" + children.join("+") + ")";
}
