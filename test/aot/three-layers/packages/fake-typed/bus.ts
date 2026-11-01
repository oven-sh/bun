export type Listener<T> = (payload: T, name: string) => void;
export class Bus<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<Listener<any>>>();
  readonly log: string[] = [];
  on<K extends keyof Events & string>(name: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners.get(name);
    if (!set) this.listeners.set(name, (set = new Set()));
    set.add(listener);
    return () => { set!.delete(listener); };
  }
  emit<K extends keyof Events & string>(name: K, payload: Events[K]): number {
    this.log.push(name);
    const set = this.listeners.get(name);
    if (!set) return 0;
    let called = 0;
    for (const listener of [...set]) { listener.call(this, payload, name); called++; }
    return called;
  }
  count(): number { let n = 0; for (const set of this.listeners.values()) n += set.size; return n; }
}
export function createStore<S, A extends { type: string }>(reducer: (state: S, action: A) => S, initial: S) {
  let state = initial;
  const subscribers: Array<(state: S) => void> = [];
  return {
    getState: () => state,
    dispatch(action: A) { state = reducer(state, action); subscribers.forEach(each => each(state)); return action; },
    subscribe(f: (state: S) => void) { subscribers.push(f); return () => { subscribers.splice(subscribers.indexOf(f), 1); }; },
  };
}
type Hook = { value: unknown };
let hooks: Hook[] = [];
let cursor = 0;
export function useState<T>(initial: T): [T, (next: T | ((old: T) => T)) => void] {
  const at = cursor++;
  if (!hooks[at]) hooks[at] = { value: initial };
  const hook = hooks[at]!;
  return [hook.value as T, next => { hook.value = typeof next === "function" ? (next as (old: T) => T)(hook.value as T) : next; }];
}
export function useMemo<T>(make: () => T, deps: unknown[]): T {
  const at = cursor++;
  const old = hooks[at]?.value as { deps: unknown[]; value: T } | undefined;
  if (old && old.deps.length === deps.length && old.deps.every((each, index) => Object.is(each, deps[index]))) return old.value;
  const value = make();
  hooks[at] = { value: { deps, value } };
  return value;
}
export function render<P, R>(component: (props: P) => R, props: P): R { cursor = 0; return component(props); }
export function resetHooks(): void { hooks = []; cursor = 0; }
export interface Element { type: string | ((props: any) => Element | string | null); props: Record<string, unknown> & { children: Array<Element | string> }; key: string | null; }
export function h(type: Element["type"], props: Record<string, unknown> | null, ...children: Array<Element | string>): Element {
  const { key = null, ...rest } = props ?? {};
  return { type, props: { ...rest, children }, key: key as string | null };
}
export function toText(node: Element | string | null): string {
  if (node === null) return "";
  if (typeof node === "string") return node;
  if (typeof node.type === "function") return toText(node.type(node.props));
  const attributes = Object.keys(node.props).filter(name => name !== "children").map(name => ` ${name}="${String(node.props[name])}"`).join("");
  return `<${node.type}${attributes}>${node.props.children.map(toText).join("")}</${node.type}>`;
}
