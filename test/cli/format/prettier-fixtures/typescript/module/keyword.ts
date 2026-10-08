module X {}

module X {
  const x = 1;
}

module X {
  module X {}
}

module X {
  module X {
    const x = 1;
  }
}

namespace X {}

namespace X {
  const x = 1;
}

namespace X {
  namespace X {}
}

namespace X {
  namespace X {
    const x = 1;
  }
}

namespace /* module */ X {}
module /* namespace */ X {}
module /* namespace */ "x" {}
