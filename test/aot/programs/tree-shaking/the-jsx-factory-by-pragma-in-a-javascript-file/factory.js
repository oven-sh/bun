export function Group(props) { return "group(" + props.children.join("+") + ")"; }
export function make(tag, props, ...children) { return typeof tag === "function" ? tag({ ...props, children }) : tag + "(" + children.join("+") + ")"; }
