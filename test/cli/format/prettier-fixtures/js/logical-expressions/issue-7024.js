const radioSelectedAttr =
  (isAnyValueSelected &&
    node.getAttribute(radioAttr.toLowerCase()) === radioValue) ||
  ((!isAnyValueSelected && values[a].default === true) || a === 0);
