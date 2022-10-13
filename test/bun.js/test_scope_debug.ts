export function wrap({
  test: test_,
  it: it_,
  describe: describe_,
  beforeEach: beforeEach_ = undefined,
  beforeAll: beforeAll_ = undefined,
  afterEach: afterEach_ = undefined,
  afterAll: afterAll_ = undefined,
}) {
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

  var beforeEach = (cb) => {
    return beforeEach_(
      cb instanceof async function () {}.constructor
        ? async () => {
            console.log(`BEFORE EACH [Enter]`);
            try {
              return await cb();
            } catch (e) {
              throw e;
            } finally {
              console.log(`BEFORE EACH [Exit]`);
            }
          }
        : () => {
            console.log(`BEFORE EACH [Enter]`);
            try {
              return cb();
            } catch (e) {
              throw e;
            } finally {
              console.log(`BEFORE EACH [Exit]`);
            }
          }
    );
  };
  var beforeAll = (cb) => {
    return beforeAll_(
      cb instanceof async function () {}.constructor
        ? async () => {
            console.log(`BEFORE ALL [Enter]`);
            try {
              return await cb();
            } catch (e) {
              throw e;
            } finally {
              console.log(`BEFORE ALL [Exit]`);
            }
          }
        : () => {
            console.log(`BEFORE ALL [Enter]`);
            try {
              return cb();
            } catch (e) {
              throw e;
            } finally {
              console.log(`BEFORE ALL [Exit]`);
            }
          }
    );
  };
  var afterEach = (cb) => {
    return afterEach_(
      cb instanceof async function () {}.constructor
        ? async () => {
            console.log(`AFTER EACH [Enter]`);
            try {
              return await cb();
            } catch (e) {
              throw e;
            } finally {
              console.log(`AFTER EACH [Exit]`);
            }
          }
        : () => {
            console.log(`AFTER EACH [Enter]`);
            try {
              return cb();
            } catch (e) {
              throw e;
            } finally {
              console.log(`AFTER EACH [Exit]`);
            }
          }
    );
  };
  var afterAll = (cb) => {
    return afterAll_(
      cb instanceof async function () {}.constructor
        ? async () => {
            console.log(`AFTER ALL [Enter]`);
            try {
              return await cb();
            } catch (e) {
              throw e;
            } finally {
              console.log(`AFTER ALL [Exit]`);
            }
          }
        : () => {
            console.log(`AFTER ALL [Enter]`);
            try {
              return cb();
            } catch (e) {
              throw e;
            } finally {
              console.log(`AFTER ALL [Exit]`);
            }
          }
    );
  };

  return { describe, it, beforeEach, beforeAll, afterEach, afterAll };
}
