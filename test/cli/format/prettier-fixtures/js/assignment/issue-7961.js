// works as expected
something.veeeeeery.looooooooooooooooooooooooooong = some.other.rather.long.chain;

// does not work if it ends with a function call
something.veeeeeery.looooooooooooooooooooooooooong = some.other.rather.long.chain.functionCall();
