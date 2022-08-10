import "i-am-bundled/cjs";
import "i-am-bundled/esm";
import "always-bundled-module/esm";
import "always-bundled-module/cjs";
import { foo } from "i-am-bundled/esm";
import { foo as foo2 } from "always-bundled-module/esm";
import cJS from "always-bundled-module/cjs";

foo();
foo2();
cJS();

export default cJS();
