export * as foo from "foo.json"
export * as bar from "bar.json" assert { }
export * as baz from "baz.json" assert { /* comment */ }

import * as foo from "foo.json"
import * as bar from "bar.json" assert { }
import * as baz from "baz.json" assert { /* comment */ }