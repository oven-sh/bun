// `import run = lib.run` is an alias whose root is a namespace import, and the only mention of that export. Also two levels deep, exported again, and for a class.
import * as lib from "./lib";
import run = lib.run;
import deep = lib.inner.deep;
import Klass = lib.Klass;
export import exportedAlias = lib.exportedThroughAlias;
import * as self from "./main";

console.log(run(), deep(), new Klass().method(), self.exportedAlias());
