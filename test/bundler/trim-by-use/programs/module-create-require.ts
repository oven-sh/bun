import { Module } from "node:module";
const { Database } = Module.createRequire(import.meta.url)("bun:sqlite");
const database = new Database(":memory:");
console.log(JSON.stringify(database.query("select 41 + 1 as answer").get()));
database.close();
