import "bun:desktop/dom";

import { act, Window } from "bun:desktop";
import { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

function App() {
  const [text, setText] = useState("");
  const [count, setCount] = useState(0);
  return (
    <>
      <input autoFocus value={text} onChange={event => setText(event.target.value.toUpperCase())} />
      <button onClick={() => setCount(count + 1)}>{text + " " + count}</button>
    </>
  );
}

const window = new Window({ width: 300, height: 200 });
const container = document.body.appendChild(document.createElement("div"));
flushSync(() => createRoot(container).render(<App />));
for (const keyCode of ["a", "b", "Tab", "Enter"]) {
  act(() => window.sendInputEvent({ type: "keyDown", keyCode }));
  act(() => window.sendInputEvent({ type: "keyUp", keyCode }));
}
console.log(container.innerHTML);
window.close();
