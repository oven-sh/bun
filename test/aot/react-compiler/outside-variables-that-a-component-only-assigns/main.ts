import * as blockScoped from "./BlockScoped";
import { handlers } from "./buttons";
import * as cache from "./Cache";
import * as temporary from "./Temporary";

for (const file of [temporary, blockScoped, cache]) {
  console.log(file.View({ n: 7 }));
  handlers.pop()!();
  console.log(file.read());
}
