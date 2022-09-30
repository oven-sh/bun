export function wrap({ test: test_, it: it_, describe: describe_ }) {
  if (it_ === undefined) {
    it_ = test_;
  }

  var describe = (label, cb) => {
    return describe_(
      label,
      cb instanceof async function () {}.constructor
        ? async () => {
            console.log(`DESCRIBE [Enter] ${label}`);
            try {
              return await cb();
            } catch (e) {
              throw e;
            } finally {
              console.log(`DESCRIBE [Exit] ${label}`);
            }
          }
        : () => {
            console.log(`DESCRIBE [Enter] ${label}`);
            try {
              return cb();
            } catch (e) {
              throw e;
            } finally {
              console.log(`DESCRIBE [Exit] ${label}`);
            }
          }
    );
  };

  var it = (label, cb) => {
    console.log("Before", label);
    return it_(
      label,
      cb instanceof async function () {}.constructor
        ? async () => {
            console.log(`TEST [Enter] ${label}`);
            try {
              return await cb();
            } catch (e) {
              throw e;
            } finally {
              console.log(`TEST [Exit] ${label}`);
            }
          }
        : () => {
            console.log(`TEST [Enter] ${label}`);
            try {
              return cb();
            } catch (e) {
              throw e;
            } finally {
              console.log(`TEST [Exit] ${label}`);
            }
          }
    );
  };

  return { describe, it };
}
