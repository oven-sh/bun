import App from "./App";
import { renderToReadableStream } from "react-dom/server";

const headers = {
  headers: {
    "Content-Type": "text/html",
  },
};

const port = Number(process.env.PORT || 3001);
Bun.serve({
  port,
  async fetch(req) {
    return new Response(await renderToReadableStream(<App />), headers);
  },
});

console.log(`Server running on\n  http://localhost:${port}`);
