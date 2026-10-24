// A default export passes barrels in every way: `export { default } from`, a default that becomes a name, a name that becomes the default, a barrel that re-exports another barrel's default, and an import of a default that a clause exports again. Of each pair one is asked for.
import theDefault, { wasDefault, fromInnerBarrel, viaClause } from "defaults";

console.log(theDefault(), wasDefault(), fromInnerBarrel(), viaClause());
