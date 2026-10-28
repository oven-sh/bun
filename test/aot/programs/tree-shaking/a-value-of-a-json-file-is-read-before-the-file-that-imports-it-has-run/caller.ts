import { early } from "./reader";
try {
  console.log(early());
} catch (e) {
  console.log((e as Error).constructor.name);
}
