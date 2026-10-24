import Module from "node:module";
const loader = () => {};
let thrown = "nothing thrown";
try {
  Module._extensions[".mustache"] = loader;
} catch (error) {
  thrown = error.constructor.name;
}
export const outcome = "strict: " + thrown + " " + (Module._extensions[".mustache"] === loader);
