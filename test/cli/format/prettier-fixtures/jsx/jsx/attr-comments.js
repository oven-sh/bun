<Component
  propFn={
    // comment
    function(arg) {
      fn(arg);
    }
  }
  propArrowFn={
    // comment
    arg => fn(arg)
  }
  propArrowWithBreak={
    // comment
    arg =>
      fn({
        makeItBreak
      })
  }
  propArray={
    // comment
    [el1, el2]
  }
  propObj={
    // comment
    { key: val }
  }
  propTemplate={
    // comment
    `text`
  }
/>;
