[
  class {
    @(decorator)
    method() {}
  },
  class {
    @(decorator())
    method() {}
  },
  class {
    @(decorator?.())
    method() {}
  },
  class {
    @(decorators[0])
    method() {}
  },
  class {
    @decorators[0]
    method() {}
  },
  class {
    @(decorators?.[0])
    method() {}
  },
  class {
    @(decorators.at(0))
    method() {}
  },
  class {
    @(decorators?.at(0))
    method() {}
  },
  class {
    @(decorators.at?.(0))
    method() {}
  },
  class {
    @(decorators.first)
    method() {}
  },
  class {
    @(decorators?.first)
    method() {}
  },
  class {
    @(decorators[first])
    method() {}
  },
  class {
    @decorators[first]
    method() {}
  },
  class {
    @(decorators["first"])
    method() {}
  },
  @(decorators[first])
  class {
    method() {}
  },
  @(decorators[0])
  class {
    method() {}
  },
]
