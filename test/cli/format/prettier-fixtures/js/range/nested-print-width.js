function f() {
  if (true) {<<<PRETTIER_RANGE_START>>>
    call("this line is 79 chars", "long", "it should", "stay as single line");
  <<<PRETTIER_RANGE_END>>>}
}
