import { run } from "./date.js";

run("toLocaleTimeString", (date, locale, options) => date.toLocaleTimeString(locale, options));
