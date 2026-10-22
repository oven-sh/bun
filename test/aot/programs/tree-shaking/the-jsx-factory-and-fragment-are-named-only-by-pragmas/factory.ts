declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }

function join(children: any[]): string {
  return children.join("+");
}

export function Group(props: { children: any[] }): string {
  return "group(" + join(props.children) + ")";
}

export function make(tag: any, props: any, ...children: any[]): any {
  return typeof tag === "function" ? tag({ ...props, children }) : tag + "(" + join(children) + ")";
}

export function neverCalled(): string {
  return "never";
}
