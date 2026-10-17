// node:sqlite is a native module: the program names it in another way than bun:sqlite
import { DatabaseSync } from "node:sqlite";
const database = new DatabaseSync(":memory:");
database.exec("create table numbers (a integer)");
database.prepare("insert into numbers values (?)").run(41);
console.log(JSON.stringify(database.prepare("select a + 1 as b from numbers").all()));
database.close();
