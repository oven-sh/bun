const G="\u{1F600}";
const re=new RegExp("(?<=" + G + "{2})a","u");
print("A: before 16-bit exec");
const r = re.exec("qĀ");
print("B: after exec -> " + r);
