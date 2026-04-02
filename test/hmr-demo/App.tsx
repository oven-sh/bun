import React from "react";
import { Counter } from "./Counter";

export function App() {
  return (
    <div style={{ fontFamily: "system-ui", padding: "20px" }}>
      <h1>HMR Test</h1>
      <Counter />
      <p style={{ color: "#666", marginTop: "20px" }}>
        Click the button a few times, then edit Counter.tsx. The count should be preserved after HMR.
      </p>
    </div>
  );
}
