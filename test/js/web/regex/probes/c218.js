const c={"source": "c?[^_\\w\\-]^|.*.{2}(?<![\\w0-9].{2}?(?=\\W(?!\u00df\\r{0,2})|\u5b57|[c\\sa-f].|(?:\\u0062){2,})|.{0,2}x)|.{0,2}(?:\\W\\u0062(?:||)?|||)|", "flags": "givms", "inputs": ["bb", "", "bbbb", "prefix bb suffix", "BB", "b", "b9", "b9b"]};
const re=new RegExp(c.source,c.flags);
print("constructed");
for(const s of c.inputs){print(JSON.stringify([...(s.matchAll(re))].map(m=>[m.index,[...m]])));}
print("done");
