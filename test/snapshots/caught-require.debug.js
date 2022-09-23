import {
__require as require
} from "http://localhost:8080/bun:wrap";
var this_package_should_not_exist_f335_0 = (() => ({}));
var this_package_should_not_exist_f335_1 = (() => ({}));
try {
  require((() => { throw (new Error(`Cannot require module "this-package-should-not-exist"`)); } )());
} catch (exception) {
}
try {
  await import("this-package-should-not-exist");
} catch (exception) {
}
import("this-package-should-not-exist").then(() => {
}, () => {
});
export async function test() {
  try {
    require((() => { throw (new Error(`Cannot require module "this-package-should-not-exist"`)); } )());
  } catch (exception) {
  }
  try {
    await import("this-package-should-not-exist");
  } catch (exception) {
  }
  import("this-package-should-not-exist").then(() => {
  }, () => {
  });
  return testDone(import.meta.url);
}

//# sourceMappingURL=http://localhost:8080/caught-require.js.map
