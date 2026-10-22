// Whether a private member is unused is a question of the file that declares it, under its own tsconfig.json. A read by name in a file of another project, which is checked first because the two import each other, counts there whatever that project reports.
import { Holder } from "./reports/holder";
import { Control } from "./reports/control";

console.log(new Holder().show(), new Control().show());
