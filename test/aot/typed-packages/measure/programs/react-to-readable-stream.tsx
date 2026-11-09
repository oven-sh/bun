import { renderToReadableStream } from "react-dom/server";
import { run } from "../turns";
import { page } from "./react/pages";

const name = process.argv[2];

await run(async () => new Response(await renderToReadableStream(page(name))).text(), { asARequest: true });
