const G="\u{1F600}"; const re=new RegExp("(?<=" + G + "{2})a","u"); print("compiled ok"); print(re.exec("no astral here at all")); print("first exec ok"); print(re.exec("z" + G + G + "a"));
