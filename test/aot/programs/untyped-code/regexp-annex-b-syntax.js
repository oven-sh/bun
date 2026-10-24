// Regular expressions that TypeScript reports and JavaScript accepts without the u and v flags (Annex B).
const shown = (pattern, text) => console.log(pattern.source, JSON.stringify(pattern.exec(text)));
shown(/\1/, "\x01");
shown(/\8/, "8");
shown(/[\1]/, "\x01");
shown(/\07/, "\x07");
shown(/\x/, "x");
shown(/\u/, "u");
shown(/\u{2}/, "uu");
shown(/\p{L}/, "p{L}");
shown(/\k<a>/, "k<a>");
shown(/[\d-a]/, "-");
shown(/a{,5}/, "a{,5}");
shown(/(?=a)*a/, "a");
shown(/(?<\u0041>.)\k<A>/, "xx");
shown(/[\c1-\x20]/, "\x11");
shown(/[Z-\c!]/, "\\");
shown(/[a-\u{10}]/, "u");
