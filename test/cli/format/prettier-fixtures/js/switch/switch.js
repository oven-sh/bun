switch (a) {
  case 3:
    alert( '3' );
    break;
  case 4:
    alert( '4' );
    break;
  case 5:
    alert( '5' );
    break;
  default:
    alert( 'default' );
}

switch (veryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryLong) {
  case 3:
    alert( '3' );
    break;
  default:
    alert( 'default' );
}

switch (veryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryLong > veryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryLong) {
  case 3:
    alert( '3' );
    break;
  default:
    alert( 'default' );
}

switch ($veryLongAndVeryVerboseVariableName && $anotherVeryLongAndVeryVerboseVariableName) {
}

switch ($longButSlightlyShorterVariableName && $anotherSlightlyShorterVariableName) {
}
