// Test the files option implementation
// Create a real entry point that imports a virtual file
import { writeFileSync } from "fs";

writeFileSync("./real_entry.js", "import { greeting } from './virtual.js'; console.log(greeting);");

const result = await Bun.build({
  entrypoints: ["./real_entry.js"],
  files: {
    "./virtual.js": "export const greeting = 'Hello from virtual file!';",
  },
});

console.log("Success:", result.success);
console.log("Outputs:", result.outputs.length);
if (result.success) {
  console.log("Output content:", await result.outputs[0].text());
} else {
  console.log("Logs:", result.logs);
}