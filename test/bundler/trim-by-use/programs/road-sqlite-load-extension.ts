import { Database } from "bun:sqlite";
const database = new Database(":memory:");
try {
  database.loadExtension("./no-such-extension");
  console.log("loaded");
} catch (error) {
  console.log("threw", (error as Error).name);
}
console.log(database.query("select 1 as one").get());
