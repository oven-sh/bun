type f1 = (
  currentRequest: {a: number},
  // TODO this is a very very very very long comment that makes it go > 80 columns
) => number;

f2 = (
  currentRequest: {a: number},
  // TODO this is a very very very very long comment that makes it go > 80 columns
): number => {};

f3 = (
  currentRequest: {a: number},
  // TODO this is a very very very very long comment that makes it go > 80 columns
) => {};

f4 = function(
  currentRequest: {a: number},
  // TODO this is a very very very very long comment that makes it go > 80 columns
) {};

class X {
  f(
    currentRequest: {a: number},
    // TODO this is a very very very very long comment that makes it go > 80 columns
  ) {}
}

function f5(
  a: number
// some comment here
): number {
  return a + 1;
}

var x = {
  getSectionMode(
    pageMetaData: PageMetaData,
    sectionMetaData: SectionMetaData
    /* $FlowFixMe This error was exposed while converting keyMirror
     * to keyMirrorRecursive */
  ): $Enum<SectionMode> {
  }
}

class X2 {
  getSectionMode(
    pageMetaData: PageMetaData,
    sectionMetaData: SectionMetaData = ['unknown']
    /* $FlowFixMe This error was exposed while converting keyMirror
     * to keyMirrorRecursive */
  ): $Enum<SectionMode> {
  }
}
