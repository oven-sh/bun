// A program like a terminal application on the typed react-reconciler of packages/bun-sound: a transcript of memoized messages, a status line that reads a context, and a spinner deep in the tree.
// A turn is what such an application does many times a second: one state update deep in the tree, rendered and committed. Every fifth turn a message arrives and the oldest leaves.
// The arguments behind the first are numbers of turns. After each of them the program marks the place for ../instruction-counts/count-instructions.ts.
import createReconciler from "react-reconciler";
import { createContext, createElement as h, memo, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { flush } from "scheduler";

declare const console: { log(...all: unknown[]): void };
declare const process: { argv: string[]; pid: number; kill(pid: number, signal: number): void };
declare function setTimeout(callback: () => void, after: number): number;
declare function clearTimeout(timer: number): void;

type Text = { kind: "text"; text: string; parent: Box | null };
type Box = { kind: "box"; name: string; props: Record<string, unknown>; children: (Box | Text)[]; parent: Box | null };
let commits = 0;

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
  resetAfterCommit: () => void commits++,
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
type Entry = { id: number; text: string };
const controls: { spin?: () => void; say?: (text: string) => void } = {};
const numberOfMessages = 24;

const Word = memo(function Word(props: { text: string }) {
  return h("word", null, props.text);
});

const Message = memo(function Message(props: Entry) {
  const theme = useContext(Theme);
  const words = useMemo(() => props.text.split(" "), [props.text]);
  return h("message", { label: theme }, h("gutter", null, String(props.id)), h("body", null, ...words.map((text: string, at: number) => h(Word, { key: at, text }))));
});

function Transcript() {
  const [messages, say] = useReducer(
    (messages: Entry[], text: string) => [...messages.slice(1), { id: messages[messages.length - 1].id + 1, text }],
    Array.from({ length: numberOfMessages }, (_, id): Entry => ({ id, text: "message " + id + " was here from the start" })),
  );
  controls.say = say;
  return h("transcript", null, ...messages.map((message: Entry) => h(Message, { key: message.id, id: message.id, text: message.text })));
}

function Spinner() {
  const [frame, setFrame] = useState(0);
  controls.spin = useCallback(() => setFrame((before: number) => before + 1), []);
  const painted = useRef(0);
  useEffect(() => {
    painted.current++;
  }, [frame]);
  return h("spinner", null, "|/-\\"[frame % 4]);
}

function Status() {
  const theme = useContext(Theme);
  return h("status", { label: theme }, h("left", null, h("pad", null, h(Spinner, null))), h("right", null, "ready"));
}

function App() {
  return h(Theme.Provider, { value: "plain" }, h("screen", null, h(Transcript, null), h("footer", null, h(Status, null))));
}

const root: Box = { kind: "box", name: "root", props: {}, children: [], parent: null };
const fail = (error: unknown) => void console.log("error " + String(error));
const container = reconciler.createContainer(root, 1, null, false, null, "", fail, fail, fail, () => {}, null);
function settle() {
  reconciler.flushSyncWork();
  flush();
  reconciler.flushPassiveEffects();
}
reconciler.updateContainer(h(App, null), container, null, null);
settle();

let turn = 0;
for (const turns of process.argv.slice(3)) {
  for (let left = Number(turns); left > 0; left--) {
    turn++;
    controls.spin!();
    if (turn % 5 === 0) controls.say!("message of turn " + turn + " has seven words");
    settle();
  }
  process.kill(process.pid, 0);
}
console.log(turn, commits, shown(root));
