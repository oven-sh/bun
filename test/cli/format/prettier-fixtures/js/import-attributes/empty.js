export * as foo from "foo.json"
export * as bar from "bar.json" with { }
export * as baz from "baz.json" with { /* comment */ }

import * as foo from "foo.json"
import * as bar from "bar.json" with { }
import * as baz from "baz.json" with { /* comment */ }
