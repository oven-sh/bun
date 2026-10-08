class x {
  a() // class 1
  {
  }

  b() // class 2
  {
    // comment
  }

  c() // class 3
  {
    call()
  }

  constructor() // class constructor
  {}

  static staticMethod() // class static
  {}

  get getter() // class getter
  {}
}

const x2 = {
  a() // object 1
  {
  },

  b() // object 2
  {
    // comment
  },

  c() // object 3
  {
    call()
  }
}

function a() // function declaration 1
{
    // comment
}

function b() // function declaration 1
{
}

function c() // function declaration 1
{
    call()
}

a = [
  function a() // function expression 1
  {
      // comment
  },

  function b() // function expression 1
  {
  },

  function c() // function expression 1
  {
      call()
  },
]
