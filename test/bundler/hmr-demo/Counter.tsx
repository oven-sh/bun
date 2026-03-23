import React, { useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);
  return (
    <div style={{ padding: "20px", border: "2px solid #333", borderRadius: "8px", display: "inline-block" }}>
      <p style={{ fontSize: "24px", margin: "0 0 10px" }}>Count: {count}</p>
      <button
        onClick={() => setCount(c => c + 1)}
        style={{
          padding: "8px 16px",
          fontSize: "16px",
          cursor: "pointer",
          background: "#333",
          color: "#fff",
          border: "none",
          borderRadius: "4px",
        }}
      >
        Increment
      </button>
    </div>
  );
}