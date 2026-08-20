const G="\u{1F600}"; print(new RegExp("(?<=" + G + "{2})a","u").exec("z" + G + G + "a"));
