import { exported, viaClosure, viaVar, viaLet, viaCommonJs, viaEquals, viaClass, viaPattern } from "./user.ts";
console.log(exported.f(), viaClosure(), viaVar(), viaLet(), viaCommonJs(), viaEquals(), viaClass(), viaPattern());
function late() {
  return require("./m.ts").f() + require("./c.cjs").g();
}
console.log(late());
