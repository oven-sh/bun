declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }

export function h(tag: any, props: any, ...children: any[]): any {
  return typeof tag === "function" ? tag({ ...props, children }) : "<" + tag + " " + JSON.stringify(props) + ">" + children.join("") + "</" + tag + ">";
}
