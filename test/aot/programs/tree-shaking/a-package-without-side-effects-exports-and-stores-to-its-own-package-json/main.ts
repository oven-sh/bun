import { pkg, version, port, spoil } from "quiet";
console.log(pkg.version, version, port(), pkg.nested.port);
spoil();
console.log(pkg.version, version, port(), pkg.nested.port);
