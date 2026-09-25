const out = typeof print === "function" ? print : console.log;
out(JSON.stringify(/(?:(a)(b*))+?(?=b)/.exec("abb")));
