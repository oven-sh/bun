// bun operators.js <function>
// Calls one function of the addon, which prints what it found. printImagesOfOperators: the image that holds each
// operator the addon calls. askForTooMuch: what operator new did with requests that no allocator can serve.
require(process.env.ADDON)[process.argv[2]]();
