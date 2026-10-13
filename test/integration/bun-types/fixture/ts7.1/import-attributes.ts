// Checked by the "TypeScript 7.1" case in ../../bun-types.test.ts, with a compiler
// that understands `declare module "*" with { type: "text" }`. It lives outside the
// fixture root so the older compilers used by the other cases never see it.

import type { HTMLBundle, XML } from "bun";
import type { Database } from "bun:sqlite";
import { expectType } from "../utilities";

// The `type` attribute picks the loader, whatever the extension says.
import text from "./template.html" with { type: "text" };
expectType(text).is<string>();

import path from "./logo.svg" with { type: "file" };
expectType(path).is<string>();

import md from "./notes.txt" with { type: "md" };
expectType(md).is<string>();

import markdown from "./notes.txt" with { type: "markdown" };
expectType(markdown).is<string>();

import toml from "./config" with { type: "toml" };
expectType(toml).is<any>();

import yaml from "./config.txt" with { type: "yaml" };
expectType(yaml).is<any>();

import jsonc from "./config.txt" with { type: "jsonc" };
expectType(jsonc).is<any>();

import json5 from "./config.txt" with { type: "json5" };
expectType(json5).is<any>();

import feed from "./feed.rss" with { type: "xml" };
expectType(feed).is<XML.Document>();

import db from "./app.db" with { type: "sqlite" };
expectType(db).is<Database>();

// `embed` narrows the attributes, so the `sqlite` declaration still matches.
import embedded from "./app.db" with { type: "sqlite", embed: "true" };
expectType(embedded).is<Database>();

import bundle from "./page.txt" with { type: "html" };
expectType(bundle).is<HTMLBundle>();

// Dynamic imports carry their attributes too.
const dynamic = await import("./template.html", { with: { type: "text" } });
expectType(dynamic.default).is<string>();

// Without an attribute the extension still decides.
import html from "./page.html";
expectType(html).is<HTMLBundle>();

import txt from "./notes.txt";
expectType(txt).is<string>();

// `type: "json"` has no declaration on purpose: the import resolves to the real
// file and keeps its precise type.
import fact from "../file.json" with { type: "json" };
expectType(fact).is<{ bun: string; fact: boolean }>();
