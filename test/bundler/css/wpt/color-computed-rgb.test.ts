import { describe } from "bun:test";
import { itBundled } from "../../expectBundled";

const runTest = (testTitle: string, input: string, expected: string) => {
  testTitle = testTitle.length === 0 ? input : testTitle;
  itBundled(testTitle, {
    files: {
      "/a.css": /* css */ `
h1 {
  color: ${input}
}
      `,
    },
    outfile: "out.css",

    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
/* a.css */
h1 {
    color: ${expected};
}
`);
    },
  });
};

describe("color-computed-rgb", () => {
  runTest("", "rgb(none none none)", "#000");
  runTest("", "rgb(none none none / none)", "#0000");
  runTest("", "rgb(128 none none)", "maroon");
  runTest("", "rgb(128 none none / none)", "#80000000");
  runTest("", "rgb(none none none / .5)", "#00000080");
  runTest("", "rgb(20% none none)", "#300");
  runTest("", "rgb(20% none none / none)", "#3000");
  runTest("", "rgb(none none none / 50%)", "#00000080");
  runTest("", "rgba(none none none)", "#000");
  runTest("", "rgba(none none none / none)", "#0000");
  runTest("", "rgba(128 none none)", "maroon");
  runTest("", "rgba(128 none none / none)", "#80000000");
  runTest("", "rgba(none none none / .5)", "#00000080");
  runTest("", "rgba(20% none none)", "#300");
  runTest("", "rgba(20% none none / none)", "#3000");
  runTest("", "rgba(none none none / 50%)", "#00000080");
  runTest("Tests that RGB channels are rounded appropriately", "rgb(2.5, 3.4, 4.6)", "#030305");
  runTest("Valid numbers should be parsed", "rgb(00, 51, 102)", "#036");
  runTest("Correct escape sequences should still parse", "r\\gb(00, 51, 102)", "#036");
  runTest("Correct escape sequences should still parse", "r\\67 b(00, 51, 102)", "#036");
  runTest("Capitalization should not affect parsing", "RGB(153, 204, 255)", "#9cf");
  runTest("Capitalization should not affect parsing", "rgB(0, 0, 0)", "#000");
  runTest("Capitalization should not affect parsing", "rgB(0, 51, 255)", "#03f");
  runTest("Lack of whitespace should not affect parsing", "rgb(0,51,255)", "#03f");
  runTest("Whitespace should not affect parsing", "rgb(0 ,  51 ,255)", "#03f");
  runTest("Comments should be allowed within function", "rgb(/* R */0, /* G */51, /* B */255)", "#03f");
  runTest("Invalid values should be clamped to 0 and 255 respectively", "rgb(-51, 306, 0)", "#0f0");
  runTest("Valid percentages should be parsed", "rgb(42%, 3%, 50%)", "#6b0880");
  runTest("Capitalization should not affect parsing", "RGB(100%, 100%, 100%)", "#fff");
  runTest("Capitalization should not affect parsing", "rgB(0%, 0%, 0%)", "#000");
  runTest("Capitalization should not affect parsing", "rgB(10%, 20%, 30%)", "#1a334d");
  runTest("Whitespace should not affect parsing", "rgb(10%,20%,30%)", "#1a334d");
  runTest("Whitespace should not affect parsing", "rgb(10%       ,  20% ,30%)", "#1a334d");
  runTest("Comments should not affect parsing", "rgb(/* R */ 10%, /* G */ 20%, /* B */ 30%)", "#1a334d");
  runTest("Invalid values should be clamped to 0 and 255 respectively", "rgb(-12%, 110%, 1400%)", "#0ff");
  runTest("RGB and RGBA are synonyms", "rgb(0, 0, 0, 0)", "#0000");
  runTest("RGB and RGBA are synonyms", "rgb(0%, 0%, 0%, 0%)", "#0000");
  runTest("RGB and RGBA are synonyms", "rgb(0%, 0%, 0%, 0)", "#0000");
  runTest("Valid numbers should be parsed", "rgba(0, 0, 0, 0)", "#0000");
  runTest("Valid numbers should be parsed", "rgba(204, 0, 102, 0.3)", "#cc00664d");
  runTest("Capitalization should not affect parsing", "RGBA(255, 255, 255, 0)", "#fff0");
  runTest("Capitalization should not affect parsing", "rgBA(0, 51, 255, 1)", "#03f");
  runTest("Invalid alpha values should be clamped to 0 and 1 respectively", "rgba(0, 51, 255, 1.1)", "#03f");
  runTest("Invalid alpha values should be clamped to 0 and 1 respectively", "rgba(0, 51, 255, 37)", "#03f");
  runTest("Valid numbers should be parsed", "rgba(0, 51, 255, 0.42)", "#0033ff6b");
  runTest("Valid numbers should be parsed", "rgba(0, 51, 255, 0)", "#03f0");
  runTest("Invalid alpha values should be clamped to 0 and 1 respectively", "rgba(0, 51, 255, -0.1)", "#03f0");
  runTest("Invalid alpha values should be clamped to 0 and 1 respectively", "rgba(0, 51, 255, -139)", "#03f0");
  runTest("Capitalization should not affect parsing", "RGBA(100%, 100%, 100%, 0)", "#fff0");
  runTest("Valid percentages should be parsed", "rgba(42%, 3%, 50%, 0.3)", "#6b08804d");
  runTest("Capitalization should not affect parsing", "rgBA(0%, 20%, 100%, 1)", "#03f");
  runTest("Invalid alpha values should be clamped to 0 and 1 respectively", "rgba(0%, 20%, 100%, 1.1)", "#03f");
  runTest("Invalid alpha values should be clamped to 0 and 1 respectively", "rgba(0%, 20%, 100%, 37)", "#03f");
  runTest("Valid percentages should be parsed", "rgba(0%, 20%, 100%, 0.42)", "#0033ff6b");
  runTest("Valid percentages should be parsed", "rgba(0%, 20%, 100%, 0)", "#03f0");
  runTest("Invalid alpha values should be clamped to 0 and 1 respectively", "rgba(0%, 20%, 100%, -0.1)", "#03f0");
  runTest("Invalid alpha values should be clamped to 0 and 1 respectively", "rgba(0%, 20%, 100%, -139)", "#03f0");
  runTest("Percent alpha values are accepted in rgb/rgba", "rgba(255, 255, 255, 0%)", "#fff0");
  runTest("Percent alpha values are accepted in rgb/rgba", "rgba(0%, 0%, 0%, 0%)", "#0000");
  runTest("RGB and RGBA are synonyms", "rgba(0%, 0%, 0%)", "#000");
  runTest("RGB and RGBA are synonyms", "rgba(0, 0, 0)", "#000");
  runTest("Red channel resolves positive infinity to 255", "rgb(calc(infinity), 0, 0)", "red");
  runTest("Green channel resolves positive infinity to 255", "rgb(0, calc(infinity), 0)", "#0f0");
  runTest("Blue channel resolves positive infinity to 255", "rgb(0, 0, calc(infinity))", "#00f");
  runTest("Alpha channel resolves positive infinity to fully opaque", "rgba(0, 0, 0, calc(infinity))", "#000");
  runTest("Red channel resolves negative infinity to zero", "rgb(calc(-infinity), 0, 0)", "#000");
  runTest("Green channel resolves negative infinity to zero", "rgb(0, calc(-infinity), 0)", "#000");
  runTest("Blue channel resolves negative infinity to zero", "rgb(0, 0, calc(-infinity))", "#000");
  runTest("Alpha channel resolves negative infinity to fully transparent", "rgba(0, 0, 0, calc(-infinity))", "#0000");
  runTest("Red channel resolves NaN to zero", "rgb(calc(NaN), 0, 0)", "rgb(calc(NaN), 0, 0)");
  runTest("Green channel resolves NaN to zero", "rgb(0, calc(NaN), 0)", "rgb(0, calc(NaN), 0)");
  runTest("Blue channel resolves NaN to zero", "rgb(0, 0, calc(NaN))", "rgb(0, 0, calc(NaN))");
  // TODO: do this later, requires a lot of machinery to change in calc parsing
  // not necessary for spec compliance as this is technially browser behavior
  // runTest("Alpha channel resolves NaN to zero", "rgba(0, 0, 0, calc(NaN))", "#0000");
  // runTest(
  //   "Red channel resolves NaN equivalent calc statements to zero",
  //   "rgb(calc(0 / 0), 0, 0)",
  //   "rgb(calc(0 / 0), 0, 0)",
  // );
  runTest(
    "Green channel resolves NaN equivalent calc statements to zero",
    "rgb(0, calc(0 / 0), 0)",
    "rgb(0, calc(0 / 0), 0)",
  );
  runTest(
    "Blue channel resolves NaN equivalent calc statements to zero",
    "rgb(0, 0, calc(0 / 0))",
    "rgb(0, 0, calc(0 / 0))",
  );
  // runTest("Alpha channel resolves NaN equivalent calc statements to zero", "rgba(0, 0, 0, calc(0 / 0))", "#0000");
  runTest("Variables above 255 get clamped to 255.", "rgb(var(--high), 0, 0)", "rgb(var(--high), 0, 0)");
  runTest("Variables below 0 get clamped to 0.", "rgb(var(--negative), 64, 128)", "rgb(var(--negative), 64, 128)");
  runTest(
    "",
    "rgb(calc(50% + (sign(1em - 10px) * 10%)), 0%, 0%, 50%)",
    "rgb(calc(50% + (sign(1em - 10px) * 10%)), 0%, 0%, 50%)",
  );
  runTest(
    "",
    "rgba(calc(50% + (sign(1em - 10px) * 10%)), 0%, 0%, 50%)",
    "rgba(calc(50% + (sign(1em - 10px) * 10%)), 0%, 0%, 50%)",
  );
  runTest(
    "",
    "rgb(calc(50 + (sign(1em - 10px) * 10)), 0, 0, 0.5)",
    "rgb(calc(50 + (sign(1em - 10px) * 10)), 0, 0, .5)",
  );
  runTest(
    "",
    "rgba(calc(50 + (sign(1em - 10px) * 10)), 0, 0, 0.5)",
    "rgba(calc(50 + (sign(1em - 10px) * 10)), 0, 0, .5)",
  );
  runTest(
    "",
    "rgb(0%, 0%, 0%, calc(50% + (sign(1em - 10px) * 10%)))",
    "rgb(0%, 0%, 0%, calc(50% + (sign(1em - 10px) * 10%)))",
  );
  runTest(
    "",
    "rgba(0%, 0%, 0%, calc(50% + (sign(1em - 10px) * 10%)))",
    "rgba(0%, 0%, 0%, calc(50% + (sign(1em - 10px) * 10%)))",
  );
  runTest(
    "",
    "rgb(0, 0, 0, calc(0.75 + (sign(1em - 10px) * 0.1)))",
    "rgb(0, 0, 0, calc(.75 + (sign(1em - 10px) * .1)))",
  );
  runTest(
    "",
    "rgba(0, 0, 0, calc(0.75 + (sign(1em - 10px) * 0.1)))",
    "rgba(0, 0, 0, calc(.75 + (sign(1em - 10px) * .1)))",
  );
  runTest(
    "",
    "rgb(calc(50% + (sign(1em - 10px) * 10%)) 0% 0% / 50%)",
    "rgb(calc(50% + (sign(1em - 10px) * 10%)) 0% 0% / 50%)",
  );
  runTest(
    "",
    "rgba(calc(50% + (sign(1em - 10px) * 10%)) 0% 0% / 50%)",
    "rgba(calc(50% + (sign(1em - 10px) * 10%)) 0% 0% / 50%)",
  );
  runTest("", "rgb(calc(50 + (sign(1em - 10px) * 10)) 0 0 / 0.5)", "rgb(calc(50 + (sign(1em - 10px) * 10)) 0 0 / .5)");
  runTest(
    "",
    "rgba(calc(50 + (sign(1em - 10px) * 10)) 0 0 / 0.5)",
    "rgba(calc(50 + (sign(1em - 10px) * 10)) 0 0 / .5)",
  );
  runTest(
    "",
    "rgb(0% 0% 0% / calc(50% + (sign(1em - 10px) * 10%)))",
    "rgb(0 0 0 / calc(50% + (sign(1em - 10px) * 10%)))",
  );
  runTest(
    "",
    "rgba(0% 0% 0% / calc(50% + (sign(1em - 10px) * 10%)))",
    "rgba(0% 0% 0% / calc(50% + (sign(1em - 10px) * 10%)))",
  );
  runTest("", "rgb(0 0 0 / calc(0.75 + (sign(1em - 10px) * 0.1)))", "rgb(0 0 0 / calc(.75 + (sign(1em - 10px) * .1)))");
  runTest(
    "",
    "rgba(0 0 0 / calc(0.75 + (sign(1em - 10px) * 0.1)))",
    "rgba(0 0 0 / calc(.75 + (sign(1em - 10px) * .1)))",
  );
  runTest(
    "",
    "rgba(calc(50% + (sign(1em - 10px) * 10%)) 0 0% / 0.5)",
    "rgba(calc(50% + (sign(1em - 10px) * 10%)) 0 0% / .5)",
  );
  runTest(
    "",
    "rgba(0% 0 0% / calc(0.75 + (sign(1em - 10px) * 0.1)))",
    "rgba(0% 0 0% / calc(.75 + (sign(1em - 10px) * .1)))",
  );
});
