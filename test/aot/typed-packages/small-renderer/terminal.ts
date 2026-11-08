// A program like a terminal application on the package small-renderer: a transcript of memoized messages, a status line that reads a context, and a spinner deep in the tree.
// A turn is what such an application does many times a second: one state update deep in the tree, rendered and committed. Every fifth turn a message arrives and the oldest leaves.
// The arguments behind the first are numbers of turns. After each of them the program marks the place for ../../instruction-counts/count-instructions.ts.
import {
  createContext,
  createRenderer,
  h,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "small-renderer";
import { createBox, createHost, print } from "./host";

declare const console: { log(...all: unknown[]): void };
declare const process: { argv: string[]; pid: number; kill(pid: number, signal: number): void };

let commits = 0;
const renderer = createRenderer(createHost(() => void commits++));

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
  return h(
    "message",
    { label: theme },
    h("gutter", null, String(props.id)),
    h("body", null, ...words.map((text, at) => h(Word, { key: at, text }))),
  );
});

function Transcript() {
  const [messages, say] = useReducer(
    (messages: Entry[], text: string) => [...messages.slice(1), { id: messages[messages.length - 1].id + 1, text }],
    Array.from({ length: numberOfMessages }, (_, id): Entry => ({ id, text: `message ${id} was here from the start` })),
  );
  controls.say = say;
  return h("transcript", null, ...messages.map(({ id, text }) => h(Message, { key: id, id, text })));
}

function Spinner() {
  const [frame, setFrame] = useState(0);
  controls.spin = useCallback(() => setFrame(before => before + 1), []);
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
  return h(Theme, { value: "plain" }, h("screen", null, h(Transcript, null), h("footer", null, h(Status, null))));
}

const screen = createBox("root", {});
renderer.render(renderer.createRoot(screen), h(App, null));
renderer.flush();

let turn = 0;
for (const turns of process.argv.slice(3)) {
  for (let left = Number(turns); left > 0; left--) {
    turn++;
    controls.spin!();
    if (turn % 5 === 0) controls.say!(`message of turn ${turn} has seven words`);
    renderer.flush();
  }
  process.kill(process.pid, 0);
}
console.log(turn, commits, print(screen));
