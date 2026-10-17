const out = typeof print === "function" ? print : console.log;
out(JSON.stringify(/(?:(x)(y)(z+))+?(?=z)/.exec("xyzz")));
