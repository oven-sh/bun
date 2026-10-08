     if (a === 0) doSomething(); // comment A1
else if (a === 1) doSomethingElse(); // comment B1
else if (a === 2) doSomethingElse(); // comment C1

     if (a === 0) doSomething(); /* comment A2 */
else if (a === 1) doSomethingElse(); /* comment B2 */
else if (a === 2) doSomethingElse(); /* comment C2 */

     if (a === 0) expr; // comment A3
else if (a === 1) expr; // comment B3
else if (a === 2) expr; // comment C3

     if (a === 0) expr; /* comment A4 */
else if (a === 1) expr; /* comment B4 */
else if (a === 2) expr; /* comment C4 */

     if (a === 0) looooooooooooooooooooooooooooooooooooooooooooooooooooooooooooong; // comment A5
else if (a === 1) looooooooooooooooooooooooooooooooooooooooooooooooooooooooooooong; // comment B5
else if (a === 2) looooooooooooooooooooooooooooooooooooooooooooooooooooooooooooong; // comment C5

function a() {
  if (a) return; /* comment 6a */
  else return 2;

  if (a) return 1; /* comment 6b */
  else return 2;

  if (a) throw e; /* comment 6d */
  else return 2;

  if (a) var a = 1; /* comment 6e */
  else return 2;

  if (a) if (b); /* comment 6f */
  else return 2;
}
