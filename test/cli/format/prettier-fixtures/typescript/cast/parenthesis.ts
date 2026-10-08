<DocumentHighlightKind>(a ? b : c);
<any>(() => {});

<x>a || {};
<x>a && [];
true || <x>a;
<x>a + <x>b;
(<x>a) = 1;

function * g() {
  const a = <T>(yield b);
}
