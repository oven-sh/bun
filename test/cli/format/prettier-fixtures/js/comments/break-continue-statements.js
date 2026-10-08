for (;;) {
  break /* comment */;
  continue /* comment */;
}

loop: for (;;) {
  break /* comment */ loop;
  break loop /* comment */;
  continue /* comment */ loop;
  continue loop /* comment */;
}
