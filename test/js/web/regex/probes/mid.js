const out=typeof print==="function"?print:console.log;
const src="(?<=([\\d_a-f\\s]\u00e9\\t+)|(?:()*(?!^[\\w0]+?||\\n{0}[^z\\s]{0})|\\W[aa-fa-f]{2,}|d{2,}.{2}(?:\\2){1,3}?|(?:\\2)??(?!(?:\\2) )(?:\\2){1,3}){0,1}?\\D(?:\\1))", flags="gimsv";
const inputs=["\u{1F600}\u{1F600}","aa","\n\n"];
for(const s of inputs){const m=[...s.matchAll(new RegExp(src,flags))].map(x=>x.index);out(JSON.stringify(s)+" -> "+JSON.stringify(m));}
