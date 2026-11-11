export function jsx(type, props) {
  return typeof type === "function" ? type(props) : "<" + type + ">" + [].concat(props.children ?? []).join("") + "</" + type + ">";
}
export const jsxs = jsx;
export const jsxDEV = jsx;
export const Fragment = "fragment";
