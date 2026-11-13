import { useState } from "react";

let childRenders = 0;
function Child({ items }: { items: string[] }) {
  childRenders++;
  return (
    <p id="child">
      {items.join(",")} renders={childRenders}
    </p>
  );
}

export default function App() {
  const [count, setCount] = useState(0);
  const items = ["a", "b"];
  return (
    <>
      <button onClick={() => setCount(count + 1)}>count {count}</button>
      <Child items={items} />
    </>
  );
}
