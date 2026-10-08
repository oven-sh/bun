switch (node && node.type) {
  case "Property":
  case "MethodDefinition":
    prop = node.key;
    break;

  case "MemberExpression":
    prop = node.property;
    break;

  // no default
}

switch (foo) {
  case "bar":
    doThing()

  // no default
}

switch (foo) {
  case "bar": //comment
    doThing(); //comment

  case "baz":
    doOtherThing(); //comment

}

switch (foo) {
  case "bar": {
    doThing();
  } //comment

  case "baz": {
    doThing();
  } //comment
}
