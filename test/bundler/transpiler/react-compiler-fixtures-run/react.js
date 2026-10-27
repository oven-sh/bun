// Enough of React to call components and hooks in order: state and memo caches per place in the tree, context, no effects.
// It stands for `react`, `react/compiler-runtime`, `react/jsx-runtime` and `react/jsx-dev-runtime`.
const sentinel = Symbol.for("react.memo_cache_sentinel");
let instances = new Map();
let instance = null;
let calls = 0;

function hook(make) {
  const at = instance.hook++;
  if (!(at in instance.hooks)) instance.hooks[at] = make();
  return instance.hooks[at];
}
const same = (a, b) => a && b && a.length === b.length && a.every((it, i) => Object.is(it, b[i]));

export const useState = init => hook(() => [typeof init === "function" ? init() : init, () => {}]);
export const useReducer = (_, arg, init) => hook(() => [init ? init(arg) : arg, () => {}]);
export const useRef = current => hook(() => ({ current }));
export function useMemo(make, deps) {
  const slot = hook(() => ({}));
  if (!same(slot.deps, deps)) {
    slot.value = make();
    slot.deps = deps;
  }
  return slot.value;
}
export const useCallback = (fn, deps) => useMemo(() => fn, deps);
export const useEffect = () => void hook(() => 0);
export const useLayoutEffect = useEffect;
export const useInsertionEffect = useEffect;
export const useImperativeHandle = useEffect;
export const useDebugValue = () => {};
export const useEffectEvent = fn => fn;
export const experimental_useEffectEvent = fn => fn;
export const useId = () => hook(() => "id");
export const useTransition = () => hook(() => [false, fn => fn()]);
export const useDeferredValue = it => it;
export const useOptimistic = it => [it, () => {}];
export const useActionState = (_, init) => hook(() => [init, () => {}, false]);
export const useSyncExternalStore = (_, get) => get();
export const startTransition = fn => fn();
export function createContext(value) {
  const context = { values: [value] };
  context.provides = context;
  context.Provider = { provides: context };
  context.Consumer = { consumes: context };
  return context;
}
export const useContext = context => context.values.at(-1);
export const use = it => (it?.values ? useContext(it) : it);
export const memo = component => component;
export const forwardRef = render => props => render(props, props.ref);
export const cache = fn => fn;
export const Fragment = "Fragment";
export const Suspense = "Suspense";
export const StrictMode = "StrictMode";
export class Component {
  constructor(props) {
    this.props = props;
  }
}
export const jsx = (type, props, key) => ({ element: sentinel, type, props: props ?? {}, key });
export const jsxs = jsx;
export const jsxDEV = jsx;
export function createElement(type, props, ...children) {
  const { key, ...rest } = props ?? {};
  if (children.length) rest.children = children.length === 1 ? children[0] : children;
  return jsx(type, rest, key);
}
export const cloneElement = (it, props) => ({ ...it, props: { ...it.props, ...props } });
export const isValidElement = it => it?.element === sentinel;
export const Children = {
  map: (it, fn) => [it].flat().map(fn),
  forEach: (it, fn) => [it].flat().forEach(fn),
  toArray: it => [it].flat(),
  count: it => [it].flat().length,
  only: it => it,
};
export function c(size) {
  const at = instance.cache++;
  return (instance.caches[at] ??= new Array(size).fill(sentinel));
}
export const unstable_useMemoCache = c;

/** What a value looks like, without identities and without the text of functions. */
export function show(value, depth = 0, seen = new Set()) {
  if (typeof value === "function") return "[function]";
  if (typeof value === "symbol" || typeof value === "bigint") return String(value);
  if (value === undefined) return "[undefined]";
  if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0))) return `[${Object.is(value, -0) ? "-0" : value}]`;
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value) || depth > 14) return "[seen]";
  seen.add(value);
  const inner = it => show(it, depth + 1, seen);
  const out = Array.isArray(value)
    ? value.map(inner)
    : value instanceof Map || value instanceof Set
      ? [value.constructor.name, ...[...value].map(inner)]
      : Object.fromEntries(Object.keys(value).map(key => [key, inner(value[key])]));
  seen.delete(value);
  return out;
}

export function at(path, run) {
  if (++calls > 5000) throw new Error("too many components");
  if (!instances.has(path)) instances.set(path, { hooks: [], caches: [] });
  const outer = instance;
  instance = instances.get(path);
  instance.hook = instance.cache = 0;
  try {
    return run();
  } finally {
    instance = outer;
  }
}

export function render(node, path) {
  if (Array.isArray(node)) return node.map((it, i) => render(it, `${path}.${it?.key ?? i}`));
  if (!isValidElement(node)) return show(node);
  const { type, props } = node;
  if (typeof type === "function") {
    const inner = `${path}/${type.name}`;
    return at(inner, () => render(type.prototype?.render ? new type(props).render() : type(props), inner));
  }
  if (type?.provides) {
    type.provides.values.push(props.value);
    try {
      return render(props.children, `${path}/Provider`);
    } finally {
      type.provides.values.pop();
    }
  }
  if (type?.consumes) return render(props.children(type.consumes.values.at(-1)), `${path}/Consumer`);
  const { children, ...rest } = props;
  return { type: show(type), props: show(rest), children: render(children, `${path}/${show(type)}`) };
}

/** A tree of its own for the next fixture. */
export function unmount() {
  instances = new Map();
}
export function nextRender() {
  calls = 0;
}

export default {
  useState, useReducer, useRef, useMemo, useCallback, useEffect, useLayoutEffect, useInsertionEffect, useImperativeHandle,
  useDebugValue, useEffectEvent, useId, useTransition, useDeferredValue, useOptimistic, useActionState, useSyncExternalStore,
  startTransition, createContext, useContext, use, memo, forwardRef, cache, Fragment, Suspense, StrictMode, Component,
  createElement, cloneElement, isValidElement, Children,
}; // prettier-ignore
