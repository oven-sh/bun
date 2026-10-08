aaaaaaaa.bbbbbbbb.cccccccc.dddddddd.eeeeeeee.ffffffff.gggggggg2 = class extends (
  aaaaaaaa.bbbbbbbb.cccccccc.dddddddd.eeeeeeee.ffffffff.gggggggg1
) {
  method () {
    console.log("foo");
  }
};

foo = class extends bar {
  method() {
    console.log("foo");
  }
};

aaaaaaaa.bbbbbbbb.cccccccc.dddddddd.eeeeeeee.ffffffff.gggggggg2 = class extends bar {
  method() {
    console.log("foo");
  }
};

foo = class extends aaaaaaaa.bbbbbbbb.cccccccc.dddddddd.eeeeeeee.ffffffff.gggggggg2 {
  method() {
    console.log("foo");
  }
};

module.exports = class A extends B {
  method () {
    console.log("foo");
  }
};
