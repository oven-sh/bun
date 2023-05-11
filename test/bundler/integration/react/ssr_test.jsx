import App from "./App";
import { renderToReadableStream } from "react-dom/server";
const response = new Response(await renderToReadableStream(<App />));
const text = await response.text();
console.log(text);
