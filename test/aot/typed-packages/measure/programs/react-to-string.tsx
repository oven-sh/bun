import { renderToString } from "react-dom/server";
import { run } from "../turns";
import { page } from "./react/pages";

const name = process.argv[2];

await run(() => renderToString(page(name)), { asARequest: true });
