/** @jsxImportSource bun:desktop */
import {
  app,
  Component,
  createContext,
  dialog,
  Menu,
  useContext,
  useRef,
  useState,
  Window,
  type Rectangle,
} from "bun:desktop";
import electron from "bun:desktop/electron";
import "bun:desktop/dom";
import { expectType } from "./utilities";

const Theme = createContext("light");

class Boundary extends Component<{ children: string }, { failed: boolean }> {
  override state = { failed: false };
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

function Counter({ step }: { step: number }) {
  const [count, setCount] = useState(0);
  const button = useRef<any>(null);
  expectType(count).is<number>();
  expectType(useContext(Theme)).is<string>();
  return (
    <>
      <button ref={button} className="a" style={{ width: 10, "--x": "1" }} onClick={() => setCount(n => n + step)}>
        {count}
      </button>
      <my-element some-attribute="1" />
      <Boundary>text</Boundary>
    </>
  );
}

using window = new Window({ title: "Counter", width: 300 }).render(
  <Theme value="dark">
    <Counter key="a" step={1} />
  </Theme>,
);
// @ts-expect-error
<Counter step="1" />;

expectType(window.getBounds()).is<Rectangle>();
window.on("close", event => event.preventDefault());
window.on("will-navigate", (_, url) => expectType(url).is<string>());
window.sendInputEvent({ type: "keyDown", keyCode: "Ctrl+A" });
app.on("second-instance", (_, argv) => expectType(argv).is<string[]>());
Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: "editMenu" }, { label: "A", submenu: [{ label: "B" }] }]));
// @ts-expect-error
Menu.buildFromTemplate([{ role: "nope" }]);
expectType((await dialog.showOpenDialog({ properties: ["openFile"] })).filePaths).is<string[]>();
expectType(dialog.showMessageBoxSync(window, { message: "Sure?" })).is<number>();

electron.app.trustOrigins(["app://bundle"]);
// @ts-expect-error
electron.app.trustOrigins("app://bundle");
