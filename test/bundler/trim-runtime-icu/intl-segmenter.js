import { attempt, done, LOCALES, SOME } from "./lists.js";

const texts = ["Hello, world. It is 3.14! Mr. Smith went to Washington. é 🇺🇸👨‍👩‍👧", "สวัสดีครับผมชื่อสมชาย", "私は日本語を話します。東京都に住んでいます。", "我喜欢学习中文。你好世界", "ສະບາຍດີຂ້ອຍຊື່", "សួស្តីខ្ញុំឈ្មោះ", "မင်္ဂလာပါကျွန်တော်", "안녕하세요 세계", "नमस्ते दुनिया", "שלום עולם", "مرحبا بالعالم"];
for (const locale of LOCALES) for (const granularity of ["grapheme", "word", "sentence"]) for (const text of texts) attempt(() => [...new Intl.Segmenter(locale, { granularity }).segment(text)].map(s => s.segment.length + (s.isWordLike ? "w" : "")).join());
for (const locale of SOME) for (const k of ["lb-strict", "lb-loose", "lb-normal", "lw-keepall", "lw-phrase", "ss-standard", "dx-thai"]) attempt(() => [...new Intl.Segmenter(locale + "-u-" + k, { granularity: "sentence" }).segment(texts[0])].length);
attempt(() => Intl.Segmenter.supportedLocalesOf(LOCALES).length);
attempt(() => JSON.stringify(new Intl.Segmenter("ja", { granularity: "word" }).segment(texts[2]).containing(3)));
done("intl-segmenter");
