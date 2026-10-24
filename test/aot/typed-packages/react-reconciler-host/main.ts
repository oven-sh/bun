// A small host for the typed react-reconciler of packages/full-types: it mounts a tree with state, a reducer, a context, memoized values and effects, updates it, and prints what the host was told.
import createReconciler from "react-reconciler";
import { createContext, createElement as h, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { flush } from "scheduler";

declare const console: { log(...all: unknown[]): void };
declare function setTimeout(callback: () => void, after: number): number;
declare function clearTimeout(timer: number): void;

type Text = { kind: "text"; text: string; parent: Box | null };
type Box = { kind: "box"; name: string; props: Record<string, unknown>; children: (Box | Text)[]; parent: Box | null };
const told: string[] = [];

function remove(parent: Box, child: Box | Text) {
  const at = parent.children.indexOf(child);
  if (at >= 0) parent.children.splice(at, 1);
  child.parent = null;
}
function append(parent: Box, child: Box | Text) {
  if (child.parent) remove(child.parent, child);
  child.parent = parent;
  parent.children.push(child);
}
function insertBefore(parent: Box, child: Box | Text, before: Box | Text) {
  if (child.parent) remove(child.parent, child);
  child.parent = parent;
  parent.children.splice(parent.children.indexOf(before), 0, child);
}
function shown(node: Box | Text): string {
  if (node.kind === "text") return node.text;
  const label = typeof node.props.label === "string" ? ` ${node.props.label}` : "";
  return `<${node.name}${label}>${node.children.map(shown).join("")}</${node.name}>`;
}

let priority = 0;
const reconciler = createReconciler({
  getRootHostContext: () => ({}),
  getChildHostContext: (parent: object) => parent,
  prepareForCommit: () => null,
  preparePortalMount: () => null,
  clearContainer: () => false,
  resetAfterCommit: (root: Box) => void told.push("commit " + shown(root)),
  shouldSetTextContent: () => false,
  createInstance: (name: string, props: Record<string, unknown>): Box => ({ kind: "box", name, props, children: [], parent: null }),
  createTextInstance: (text: string): Text => ({ kind: "text", text, parent: null }),
  resetTextContent() {},
  hideTextInstance() {},
  unhideTextInstance() {},
  getPublicInstance: (instance: unknown) => instance,
  hideInstance() {},
  unhideInstance() {},
  appendInitialChild: append,
  appendChild: append,
  insertBefore,
  finalizeInitialChildren: () => false,
  isPrimaryRenderer: true,
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,
  beforeActiveInstanceBlur() {},
  afterActiveInstanceBlur() {},
  detachDeletedInstance() {},
  getInstanceFromNode: () => null,
  prepareScopeUpdate() {},
  getInstanceFromScope: () => null,
  appendChildToContainer: append,
  insertInContainerBefore: insertBefore,
  removeChildFromContainer: remove,
  removeChild: remove,
  commitUpdate(node: Box, _name: string, _before: unknown, props: Record<string, unknown>) {
    node.props = props;
  },
  commitTextUpdate(node: Text, _before: string, text: string) {
    node.text = text;
  },
  setCurrentUpdatePriority(next: number) {
    priority = next;
  },
  getCurrentUpdatePriority: () => priority,
  resolveUpdatePriority: () => (priority !== 0 ? priority : 32),
  maySuspendCommit: () => false,
  NotPendingTransition: undefined,
  HostTransitionContext: createContext(null),
  resetFormInstance() {},
  requestPostPaintCallback() {},
  shouldAttemptEagerTransition: () => false,
  trackSchedulerEvent() {},
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1.1,
  preloadInstance: () => true,
  startSuspendingCommit() {},
  suspendInstance() {},
  waitForCommitToBeReady: () => null,
});

const Theme = createContext("plain");
type Action = { add: string } | { drop: number };
const controls: { bump?: () => void; dispatch?: (action: Action) => void; theme?: (name: string) => void } = {};

const Row = memo(function Row(props: { text: string; index: number }) {
  const theme = useContext(Theme);
  const renders = useRef(0);
  renders.current++;
  return h("row", { label: theme }, `${props.index}:${props.text}:${renders.current}`);
});

function List() {
  const [rows, dispatch] = useReducer((rows: string[], action: Action) => ("add" in action ? [...rows, action.add] : rows.filter((_, at) => at !== action.drop)), ["a", "b"]);
  controls.dispatch = dispatch;
  const lengths = useMemo(() => rows.map((row: string) => row.length).join(","), [rows]);
  useLayoutEffect(() => {
    told.push("layout " + rows.length);
    return () => void told.push("layout gone " + rows.length);
  }, [rows.length]);
  return h("list", { label: lengths }, ...rows.map((text: string, index: number) => h(Row, { key: text, text, index })));
}

function App() {
  const [count, setCount] = useState(0);
  const [theme, setTheme] = useState("plain");
  controls.bump = useCallback(() => setCount((before: number) => before + 1), []);
  controls.theme = setTheme;
  useEffect(() => {
    told.push("effect " + count);
    return () => void told.push("effect gone " + count);
  }, [count]);
  return h(Theme.Provider, { value: theme }, h("app", null, "count " + count, count % 2 ? h("odd", null) : null, h(List, null)));
}

const root: Box = { kind: "box", name: "root", props: {}, children: [], parent: null };
const fail = (error: unknown) => void told.push("error " + String(error));
const container = reconciler.createContainer(root, 1, null, false, null, "", fail, fail, fail, () => {}, null);
function settle() {
  reconciler.flushSyncWork();
  flush();
  reconciler.flushPassiveEffects();
}
reconciler.updateContainer(h(App, null), container, null, null);
settle();
for (let turn = 0; turn < 3; turn++) {
  controls.bump!();
  settle();
}
controls.dispatch!({ add: "ccc" });
settle();
controls.theme!("dark");
settle();
controls.dispatch!({ drop: 0 });
controls.bump!();
settle();
reconciler.updateContainer(null, container, null, null);
settle();
console.log(told.join("\n"));
