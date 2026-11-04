import { jsx } from "../../react-stand-in/jsx-runtime.js";

export function useMemo(create) {
  return create();
}
export function useCallback(callback) {
  return callback;
}
export function memo(component) {
  return component;
}
export function forwardRef(component) {
  return props => component(props, null);
}
export function createElement(type, props, ...children) {
  return jsx(type, children.length ? { ...props, children } : { ...props });
}
