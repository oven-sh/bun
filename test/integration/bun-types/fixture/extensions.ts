import { expectType } from "./utilities";

import html from "hey.html";
expectType(html).is<Bun.HTMLBundle>();

import text from "hey.txt";
expectType(text).is<string>();

import toml from "hey.toml";
expectType(toml).is<any>();

import jsonc from "hey.jsonc";
expectType(jsonc).is<any>();

import lock from "./bun.lock";
expectType(lock).is<Bun.BunLockFile>();
