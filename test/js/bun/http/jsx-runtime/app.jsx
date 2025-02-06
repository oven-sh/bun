import React from "react";
import { createRoot } from "react-dom/client";

const App = () => {
  return (
    <div>
      <h1>Hello from JSX</h1>
      <button>Click me</button>
    </div>
  );
};

createRoot(document.getElementById("root")).render(<App />);
