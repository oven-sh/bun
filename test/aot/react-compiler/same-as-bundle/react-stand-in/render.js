const caches = new Map();
let rendering;
let hookCount = 0;

// Calls `component` with the caches from its earlier calls, like React does for a mounted component.
export function render(component, props) {
  rendering = component;
  hookCount = 0;
  return component(props);
}

export function cacheOfNextHook(size) {
  let ofComponent = caches.get(rendering);
  if (!ofComponent) caches.set(rendering, (ofComponent = []));
  if (!ofComponent[hookCount]) {
    console.error("[react-compiler] a cache of " + size);
    ofComponent[hookCount] = new Array(size).fill(Symbol.for("react.memo_cache_sentinel"));
  }
  return ofComponent[hookCount++];
}
