// Mounts a tree with state, a reducer, a context, memoized values and effects on the package small-renderer, updates it, and prints what the host was told.
import {
  createContext,
  createRenderer,
  h,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "small-renderer";
import { createBox, createHost, print } from "./host";

declare const console: { log(...all: unknown[]): void };

const told: string[] = [];
const renderer = createRenderer(createHost(container => void told.push("commit " + print(container))));

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
  const [rows, dispatch] = useReducer(
    (rows: string[], action: Action) =>
      "add" in action ? [...rows, action.add] : rows.filter((_, at) => at !== action.drop),
    ["a", "b"],
  );
  controls.dispatch = dispatch;
  const lengths = useMemo(() => rows.map(row => row.length).join(","), [rows]);
  useLayoutEffect(() => {
    told.push("layout " + rows.length);
    return () => void told.push("layout gone " + rows.length);
  }, [rows.length]);
  return h("list", { label: lengths }, ...rows.map((text, index) => h(Row, { key: text, text, index })));
}

function App() {
  const [count, setCount] = useState(0);
  const [theme, setTheme] = useState("plain");
  controls.bump = useCallback(() => setCount(before => before + 1), []);
  controls.theme = setTheme;
  useEffect(() => {
    told.push("effect " + count);
    return () => void told.push("effect gone " + count);
  }, [count]);
  return h(Theme, { value: theme }, h("app", null, "count " + count, count % 2 ? h("odd", null) : null, h(List, null)));
}

const root = renderer.createRoot(createBox("root", {}));
renderer.render(root, h(App, null));
renderer.flush();
for (let turn = 0; turn < 3; turn++) {
  controls.bump!();
  renderer.flush();
}
controls.dispatch!({ add: "ccc" });
renderer.flush();
controls.theme!("dark");
renderer.flush();
controls.dispatch!({ drop: 0 });
controls.bump!();
renderer.flush();
renderer.later(() => controls.dispatch!({ add: "dd" }));
controls.bump!();
renderer.flush();
renderer.render(root, null);
renderer.flush();
console.log(told.join("\n"));
