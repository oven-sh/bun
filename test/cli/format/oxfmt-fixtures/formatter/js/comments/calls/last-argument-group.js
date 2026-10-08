call(editor /* comment */, () => {
  //
});
call(editor, /* comment */
  () => {
    //
  }
);
call(/* */ editor /* comment */, () => {
  //
});
call(/* comment */
  () => {
    //
  }
);
call(
  function () {
    var a = 1;
    // one
  },
  // two
);