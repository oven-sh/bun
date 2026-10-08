((b) => (c) => (d) => {
  return 3;
})(x);

function f(
  a = (fooLorem) => (bazIpsum) => (barLorem) => {
    return 3;
  }
) {}

(
  (fooLoremIpsumFactory) =>
  (bazLoremIpsumFactory) =>
  (barLoremIpsumServiceFactory) => {
    return 3;
  }
)(x);

(
  (b) => (c) => (d) =>
    b + fooLoremIpsumFactory(c) - bazLoremIpsumFactory(b + d)
)(x, fooLoremIpsumFactory, fooLoremIpsumFactory);

(
  (fooLorem) => (bazIpsum) => (barLorem) =>
    b + fooLoremIpsumFactory(c) - bazLoremIpsumFactory(b + d)
)(boo);

(
  (fooLoremIpsumFactory) =>
  (bazLoremIpsumFactory) =>
  (barLoremIpsumServiceFactory) =>
    b + fooLoremIpsumFactory(c) - bazLoremIpsumFactory(b + d)
)(x);