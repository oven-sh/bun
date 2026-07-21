const out = typeof print === "function" ? print : console.log;
out(JSON.stringify(/(?:(x)(y+))+?(?=y)/.exec("xyy")));
