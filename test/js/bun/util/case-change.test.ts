import { describe, expect, test } from "bun:test";

// Case-changing utilities on the `Bun` global (issue #15087).
//
// Expected values are embedded data generated from the `change-case` npm
// package (v5.4.4), which is not a dependency of this repo.

type CaseFn = (input: string) => string;

const CASE_NAMES = [
  "camelCase",
  "capitalCase",
  "constantCase",
  "dotCase",
  "kebabCase",
  "pascalCase",
  "snakeCase",
  "trainCase",
] as const;
type CaseName = (typeof CASE_NAMES)[number];

const bunFns: Record<CaseName, CaseFn> = {
  camelCase: Bun.camelCase,
  capitalCase: Bun.capitalCase,
  constantCase: Bun.constantCase,
  dotCase: Bun.dotCase,
  kebabCase: Bun.kebabCase,
  pascalCase: Bun.pascalCase,
  snakeCase: Bun.snakeCase,
  trainCase: Bun.trainCase,
};

// [input, [camelCase, capitalCase, constantCase, dotCase, kebabCase, pascalCase, snakeCase, trainCase]]
// prettier-ignore
const EXPECTED: [string, [string, string, string, string, string, string, string, string]][] = [
  ["test", ["test", "Test", "TEST", "test", "test", "Test", "test", "Test"]],
  ["foo", ["foo", "Foo", "FOO", "foo", "foo", "Foo", "foo", "Foo"]],
  ["a", ["a", "A", "A", "a", "a", "A", "a", "A"]],
  ["", ["", "", "", "", "", "", "", ""]],
  ["test string", ["testString", "Test String", "TEST_STRING", "test.string", "test-string", "TestString", "test_string", "Test-String"]],
  ["test_string", ["testString", "Test String", "TEST_STRING", "test.string", "test-string", "TestString", "test_string", "Test-String"]],
  ["test-string", ["testString", "Test String", "TEST_STRING", "test.string", "test-string", "TestString", "test_string", "Test-String"]],
  ["test.string", ["testString", "Test String", "TEST_STRING", "test.string", "test-string", "TestString", "test_string", "Test-String"]],
  ["test/string", ["testString", "Test String", "TEST_STRING", "test.string", "test-string", "TestString", "test_string", "Test-String"]],
  ["test\tstring", ["testString", "Test String", "TEST_STRING", "test.string", "test-string", "TestString", "test_string", "Test-String"]],
  ["Test String", ["testString", "Test String", "TEST_STRING", "test.string", "test-string", "TestString", "test_string", "Test-String"]],
  ["TEST STRING", ["testString", "Test String", "TEST_STRING", "test.string", "test-string", "TestString", "test_string", "Test-String"]],
  ["TestString", ["testString", "Test String", "TEST_STRING", "test.string", "test-string", "TestString", "test_string", "Test-String"]],
  ["testString", ["testString", "Test String", "TEST_STRING", "test.string", "test-string", "TestString", "test_string", "Test-String"]],
  ["TEST_STRING", ["testString", "Test String", "TEST_STRING", "test.string", "test-string", "TestString", "test_string", "Test-String"]],
  ["XMLParser", ["xmlParser", "Xml Parser", "XML_PARSER", "xml.parser", "xml-parser", "XmlParser", "xml_parser", "Xml-Parser"]],
  ["getHTTPSURL", ["getHttpsurl", "Get Httpsurl", "GET_HTTPSURL", "get.httpsurl", "get-httpsurl", "GetHttpsurl", "get_httpsurl", "Get-Httpsurl"]],
  ["parseJSON", ["parseJson", "Parse Json", "PARSE_JSON", "parse.json", "parse-json", "ParseJson", "parse_json", "Parse-Json"]],
  ["simpleXML", ["simpleXml", "Simple Xml", "SIMPLE_XML", "simple.xml", "simple-xml", "SimpleXml", "simple_xml", "Simple-Xml"]],
  ["PDFLoader", ["pdfLoader", "Pdf Loader", "PDF_LOADER", "pdf.loader", "pdf-loader", "PdfLoader", "pdf_loader", "Pdf-Loader"]],
  ["I18N", ["i18N", "I18 N", "I18_N", "i18.n", "i18-n", "I18N", "i18_n", "I18-N"]],
  ["ABC", ["abc", "Abc", "ABC", "abc", "abc", "Abc", "abc", "Abc"]],
  ["ABCdef", ["abCdef", "Ab Cdef", "AB_CDEF", "ab.cdef", "ab-cdef", "AbCdef", "ab_cdef", "Ab-Cdef"]],
  ["ABCDef", ["abcDef", "Abc Def", "ABC_DEF", "abc.def", "abc-def", "AbcDef", "abc_def", "Abc-Def"]],
  ["HTMLElement", ["htmlElement", "Html Element", "HTML_ELEMENT", "html.element", "html-element", "HtmlElement", "html_element", "Html-Element"]],
  ["innerHTML", ["innerHtml", "Inner Html", "INNER_HTML", "inner.html", "inner-html", "InnerHtml", "inner_html", "Inner-Html"]],
  ["XMLHttpRequest", ["xmlHttpRequest", "Xml Http Request", "XML_HTTP_REQUEST", "xml.http.request", "xml-http-request", "XmlHttpRequest", "xml_http_request", "Xml-Http-Request"]],
  ["getURLParams", ["getUrlParams", "Get Url Params", "GET_URL_PARAMS", "get.url.params", "get-url-params", "GetUrlParams", "get_url_params", "Get-Url-Params"]],
  ["isHTTPS", ["isHttps", "Is Https", "IS_HTTPS", "is.https", "is-https", "IsHttps", "is_https", "Is-Https"]],
  ["CSSStyleSheet", ["cssStyleSheet", "Css Style Sheet", "CSS_STYLE_SHEET", "css.style.sheet", "css-style-sheet", "CssStyleSheet", "css_style_sheet", "Css-Style-Sheet"]],
  ["IOError", ["ioError", "Io Error", "IO_ERROR", "io.error", "io-error", "IoError", "io_error", "Io-Error"]],
  ["UIKit", ["uiKit", "Ui Kit", "UI_KIT", "ui.kit", "ui-kit", "UiKit", "ui_kit", "Ui-Kit"]],
  ["version 1.2.10", ["version_1_2_10", "Version 1 2 10", "VERSION_1_2_10", "version.1.2.10", "version-1-2-10", "Version_1_2_10", "version_1_2_10", "Version-1-2-10"]],
  ["TestV2", ["testV2", "Test V2", "TEST_V2", "test.v2", "test-v2", "TestV2", "test_v2", "Test-V2"]],
  ["test123", ["test123", "Test123", "TEST123", "test123", "test123", "Test123", "test123", "Test123"]],
  ["123test", ["123test", "123test", "123TEST", "123test", "123test", "123test", "123test", "123test"]],
  ["test 123 value", ["test_123Value", "Test 123 Value", "TEST_123_VALUE", "test.123.value", "test-123-value", "Test_123Value", "test_123_value", "Test-123-Value"]],
  ["1st place", ["1stPlace", "1st Place", "1ST_PLACE", "1st.place", "1st-place", "1stPlace", "1st_place", "1st-Place"]],
  ["v2beta1", ["v2beta1", "V2beta1", "V2BETA1", "v2beta1", "v2beta1", "V2beta1", "v2beta1", "V2beta1"]],
  ["ES6Module", ["es6Module", "Es6 Module", "ES6_MODULE", "es6.module", "es6-module", "Es6Module", "es6_module", "Es6-Module"]],
  ["utf8Decode", ["utf8Decode", "Utf8 Decode", "UTF8_DECODE", "utf8.decode", "utf8-decode", "Utf8Decode", "utf8_decode", "Utf8-Decode"]],
  ["base64Encode", ["base64Encode", "Base64 Encode", "BASE64_ENCODE", "base64.encode", "base64-encode", "Base64Encode", "base64_encode", "Base64-Encode"]],
  ["h1Element", ["h1Element", "H1 Element", "H1_ELEMENT", "h1.element", "h1-element", "H1Element", "h1_element", "H1-Element"]],
  ["int32Array", ["int32Array", "Int32 Array", "INT32_ARRAY", "int32.array", "int32-array", "Int32Array", "int32_array", "Int32-Array"]],
  ["123", ["123", "123", "123", "123", "123", "123", "123", "123"]],
  ["123 456", ["123_456", "123 456", "123_456", "123.456", "123-456", "123_456", "123_456", "123-456"]],
  ["a1b2c3", ["a1b2c3", "A1b2c3", "A1B2C3", "a1b2c3", "a1b2c3", "A1b2c3", "a1b2c3", "A1b2c3"]],
  ["test0", ["test0", "Test0", "TEST0", "test0", "test0", "Test0", "test0", "Test0"]],
  ["foo___bar", ["fooBar", "Foo Bar", "FOO_BAR", "foo.bar", "foo-bar", "FooBar", "foo_bar", "Foo-Bar"]],
  ["foo---bar", ["fooBar", "Foo Bar", "FOO_BAR", "foo.bar", "foo-bar", "FooBar", "foo_bar", "Foo-Bar"]],
  ["foo...bar", ["fooBar", "Foo Bar", "FOO_BAR", "foo.bar", "foo-bar", "FooBar", "foo_bar", "Foo-Bar"]],
  ["foo   bar", ["fooBar", "Foo Bar", "FOO_BAR", "foo.bar", "foo-bar", "FooBar", "foo_bar", "Foo-Bar"]],
  ["  leading spaces  ", ["leadingSpaces", "Leading Spaces", "LEADING_SPACES", "leading.spaces", "leading-spaces", "LeadingSpaces", "leading_spaces", "Leading-Spaces"]],
  ["__private", ["private", "Private", "PRIVATE", "private", "private", "Private", "private", "Private"]],
  ["--dashed--", ["dashed", "Dashed", "DASHED", "dashed", "dashed", "Dashed", "dashed", "Dashed"]],
  ["..dotted..", ["dotted", "Dotted", "DOTTED", "dotted", "dotted", "Dotted", "dotted", "Dotted"]],
  ["  ", ["", "", "", "", "", "", "", ""]],
  ["\t\ttabs\t\t", ["tabs", "Tabs", "TABS", "tabs", "tabs", "Tabs", "tabs", "Tabs"]],
  ["foo_-_bar", ["fooBar", "Foo Bar", "FOO_BAR", "foo.bar", "foo-bar", "FooBar", "foo_bar", "Foo-Bar"]],
  ["foo.-bar", ["fooBar", "Foo Bar", "FOO_BAR", "foo.bar", "foo-bar", "FooBar", "foo_bar", "Foo-Bar"]],
  ["FOO_BAR_BAZ", ["fooBarBaz", "Foo Bar Baz", "FOO_BAR_BAZ", "foo.bar.baz", "foo-bar-baz", "FooBarBaz", "foo_bar_baz", "Foo-Bar-Baz"]],
  ["ALLCAPS", ["allcaps", "Allcaps", "ALLCAPS", "allcaps", "allcaps", "Allcaps", "allcaps", "Allcaps"]],
  ["FOO BAR", ["fooBar", "Foo Bar", "FOO_BAR", "foo.bar", "foo-bar", "FooBar", "foo_bar", "Foo-Bar"]],
  ["FOO-BAR", ["fooBar", "Foo Bar", "FOO_BAR", "foo.bar", "foo-bar", "FooBar", "foo_bar", "Foo-Bar"]],
  ["FOO.BAR", ["fooBar", "Foo Bar", "FOO_BAR", "foo.bar", "foo-bar", "FooBar", "foo_bar", "Foo-Bar"]],
  ["fooBarBaz", ["fooBarBaz", "Foo Bar Baz", "FOO_BAR_BAZ", "foo.bar.baz", "foo-bar-baz", "FooBarBaz", "foo_bar_baz", "Foo-Bar-Baz"]],
  ["FooBarBaz", ["fooBarBaz", "Foo Bar Baz", "FOO_BAR_BAZ", "foo.bar.baz", "foo-bar-baz", "FooBarBaz", "foo_bar_baz", "Foo-Bar-Baz"]],
  ["Foo Bar", ["fooBar", "Foo Bar", "FOO_BAR", "foo.bar", "foo-bar", "FooBar", "foo_bar", "Foo-Bar"]],
  ["MiXeD CaSe", ["miXeDCaSe", "Mi Xe D Ca Se", "MI_XE_D_CA_SE", "mi.xe.d.ca.se", "mi-xe-d-ca-se", "MiXeDCaSe", "mi_xe_d_ca_se", "Mi-Xe-D-Ca-Se"]],
  ["already camelCase", ["alreadyCamelCase", "Already Camel Case", "ALREADY_CAMEL_CASE", "already.camel.case", "already-camel-case", "AlreadyCamelCase", "already_camel_case", "Already-Camel-Case"]],
  ["already PascalCase", ["alreadyPascalCase", "Already Pascal Case", "ALREADY_PASCAL_CASE", "already.pascal.case", "already-pascal-case", "AlreadyPascalCase", "already_pascal_case", "Already-Pascal-Case"]],
  ["already_snake_case", ["alreadySnakeCase", "Already Snake Case", "ALREADY_SNAKE_CASE", "already.snake.case", "already-snake-case", "AlreadySnakeCase", "already_snake_case", "Already-Snake-Case"]],
  ["already-kebab-case", ["alreadyKebabCase", "Already Kebab Case", "ALREADY_KEBAB_CASE", "already.kebab.case", "already-kebab-case", "AlreadyKebabCase", "already_kebab_case", "Already-Kebab-Case"]],
  ["Already Capital Case", ["alreadyCapitalCase", "Already Capital Case", "ALREADY_CAPITAL_CASE", "already.capital.case", "already-capital-case", "AlreadyCapitalCase", "already_capital_case", "Already-Capital-Case"]],
  ["ALREADY_CONSTANT_CASE", ["alreadyConstantCase", "Already Constant Case", "ALREADY_CONSTANT_CASE", "already.constant.case", "already-constant-case", "AlreadyConstantCase", "already_constant_case", "Already-Constant-Case"]],
  ["Train-Case-Input", ["trainCaseInput", "Train Case Input", "TRAIN_CASE_INPUT", "train.case.input", "train-case-input", "TrainCaseInput", "train_case_input", "Train-Case-Input"]],
  ["dot.case.input", ["dotCaseInput", "Dot Case Input", "DOT_CASE_INPUT", "dot.case.input", "dot-case-input", "DotCaseInput", "dot_case_input", "Dot-Case-Input"]],
  ["path/case/input", ["pathCaseInput", "Path Case Input", "PATH_CASE_INPUT", "path.case.input", "path-case-input", "PathCaseInput", "path_case_input", "Path-Case-Input"]],
  ["Sentence case input", ["sentenceCaseInput", "Sentence Case Input", "SENTENCE_CASE_INPUT", "sentence.case.input", "sentence-case-input", "SentenceCaseInput", "sentence_case_input", "Sentence-Case-Input"]],
  ["no case input", ["noCaseInput", "No Case Input", "NO_CASE_INPUT", "no.case.input", "no-case-input", "NoCaseInput", "no_case_input", "No-Case-Input"]],
  ["A", ["a", "A", "A", "a", "a", "A", "a", "A"]],
  ["z", ["z", "Z", "Z", "z", "z", "Z", "z", "Z"]],
  ["Z", ["z", "Z", "Z", "z", "z", "Z", "z", "Z"]],
  ["0", ["0", "0", "0", "0", "0", "0", "0", "0"]],
  ["backgroundColor", ["backgroundColor", "Background Color", "BACKGROUND_COLOR", "background.color", "background-color", "BackgroundColor", "background_color", "Background-Color"]],
  ["border-top-color", ["borderTopColor", "Border Top Color", "BORDER_TOP_COLOR", "border.top.color", "border-top-color", "BorderTopColor", "border_top_color", "Border-Top-Color"]],
  ["MAX_RETRY_COUNT", ["maxRetryCount", "Max Retry Count", "MAX_RETRY_COUNT", "max.retry.count", "max-retry-count", "MaxRetryCount", "max_retry_count", "Max-Retry-Count"]],
  ["Content-Type", ["contentType", "Content Type", "CONTENT_TYPE", "content.type", "content-type", "ContentType", "content_type", "Content-Type"]],
  ["X-Forwarded-For", ["xForwardedFor", "X Forwarded For", "X_FORWARDED_FOR", "x.forwarded.for", "x-forwarded-for", "XForwardedFor", "x_forwarded_for", "X-Forwarded-For"]],
  ["user_id", ["userId", "User Id", "USER_ID", "user.id", "user-id", "UserId", "user_id", "User-Id"]],
  ["getUserById", ["getUserById", "Get User By Id", "GET_USER_BY_ID", "get.user.by.id", "get-user-by-id", "GetUserById", "get_user_by_id", "Get-User-By-Id"]],
  ["class_name", ["className", "Class Name", "CLASS_NAME", "class.name", "class-name", "ClassName", "class_name", "Class-Name"]],
  ["className", ["className", "Class Name", "CLASS_NAME", "class.name", "class-name", "ClassName", "class_name", "Class-Name"]],
  ["is_active", ["isActive", "Is Active", "IS_ACTIVE", "is.active", "is-active", "IsActive", "is_active", "Is-Active"]],
  ["isActive", ["isActive", "Is Active", "IS_ACTIVE", "is.active", "is-active", "IsActive", "is_active", "Is-Active"]],
  ["created_at", ["createdAt", "Created At", "CREATED_AT", "created.at", "created-at", "CreatedAt", "created_at", "Created-At"]],
  ["createdAt", ["createdAt", "Created At", "CREATED_AT", "created.at", "created-at", "CreatedAt", "created_at", "Created-At"]],
  ["HTTPSConnection", ["httpsConnection", "Https Connection", "HTTPS_CONNECTION", "https.connection", "https-connection", "HttpsConnection", "https_connection", "Https-Connection"]],
  ["myXMLParser", ["myXmlParser", "My Xml Parser", "MY_XML_PARSER", "my.xml.parser", "my-xml-parser", "MyXmlParser", "my_xml_parser", "My-Xml-Parser"]],
  ["getDBConnection", ["getDbConnection", "Get Db Connection", "GET_DB_CONNECTION", "get.db.connection", "get-db-connection", "GetDbConnection", "get_db_connection", "Get-Db-Connection"]],
  ["setHTTPSEnabled", ["setHttpsEnabled", "Set Https Enabled", "SET_HTTPS_ENABLED", "set.https.enabled", "set-https-enabled", "SetHttpsEnabled", "set_https_enabled", "Set-Https-Enabled"]],
  ["enableSSL", ["enableSsl", "Enable Ssl", "ENABLE_SSL", "enable.ssl", "enable-ssl", "EnableSsl", "enable_ssl", "Enable-Ssl"]],
  ["useGPU", ["useGpu", "Use Gpu", "USE_GPU", "use.gpu", "use-gpu", "UseGpu", "use_gpu", "Use-Gpu"]],
  ["readCSV", ["readCsv", "Read Csv", "READ_CSV", "read.csv", "read-csv", "ReadCsv", "read_csv", "Read-Csv"]],
  ["parseHTML", ["parseHtml", "Parse Html", "PARSE_HTML", "parse.html", "parse-html", "ParseHtml", "parse_html", "Parse-Html"]],
  ["toJSON", ["toJson", "To Json", "TO_JSON", "to.json", "to-json", "ToJson", "to_json", "To-Json"]],
  ["fromURL", ["fromUrl", "From Url", "FROM_URL", "from.url", "from-url", "FromUrl", "from_url", "From-Url"]],
  ["isNaN", ["isNaN", "Is Na N", "IS_NA_N", "is.na.n", "is-na-n", "IsNaN", "is_na_n", "Is-Na-N"]],
  ["toString", ["toString", "To String", "TO_STRING", "to.string", "to-string", "ToString", "to_string", "To-String"]],
  ["valueOf", ["valueOf", "Value Of", "VALUE_OF", "value.of", "value-of", "ValueOf", "value_of", "Value-Of"]],
  ["first_name", ["firstName", "First Name", "FIRST_NAME", "first.name", "first-name", "FirstName", "first_name", "First-Name"]],
  ["last_name", ["lastName", "Last Name", "LAST_NAME", "last.name", "last-name", "LastName", "last_name", "Last-Name"]],
  ["email_address", ["emailAddress", "Email Address", "EMAIL_ADDRESS", "email.address", "email-address", "EmailAddress", "email_address", "Email-Address"]],
  ["phone_number", ["phoneNumber", "Phone Number", "PHONE_NUMBER", "phone.number", "phone-number", "PhoneNumber", "phone_number", "Phone-Number"]],
  ["order_total", ["orderTotal", "Order Total", "ORDER_TOTAL", "order.total", "order-total", "OrderTotal", "order_total", "Order-Total"]],
  ["created_at", ["createdAt", "Created At", "CREATED_AT", "created.at", "created-at", "CreatedAt", "created_at", "Created-At"]],
  ["updated_at", ["updatedAt", "Updated At", "UPDATED_AT", "updated.at", "updated-at", "UpdatedAt", "updated_at", "Updated-At"]],
  ["is_deleted", ["isDeleted", "Is Deleted", "IS_DELETED", "is.deleted", "is-deleted", "IsDeleted", "is_deleted", "Is-Deleted"]],
  ["well-known", ["wellKnown", "Well Known", "WELL_KNOWN", "well.known", "well-known", "WellKnown", "well_known", "Well-Known"]],
  ["read-only", ["readOnly", "Read Only", "READ_ONLY", "read.only", "read-only", "ReadOnly", "read_only", "Read-Only"]],
  ["built-in", ["builtIn", "Built In", "BUILT_IN", "built.in", "built-in", "BuiltIn", "built_in", "Built-In"]],
  ["self-contained", ["selfContained", "Self Contained", "SELF_CONTAINED", "self.contained", "self-contained", "SelfContained", "self_contained", "Self-Contained"]],
  ["---", ["", "", "", "", "", "", "", ""]],
  ["___", ["", "", "", "", "", "", "", ""]],
  ["...", ["", "", "", "", "", "", "", ""]],
  ["///", ["", "", "", "", "", "", "", ""]],
  ["-_.-_.", ["", "", "", "", "", "", "", ""]],
  ["café latte", ["caféLatte", "Café Latte", "CAFÉ_LATTE", "café.latte", "café-latte", "CaféLatte", "café_latte", "Café-Latte"]],
  ["naïve résumé", ["naïveRésumé", "Naïve Résumé", "NAÏVE_RÉSUMÉ", "naïve.résumé", "naïve-résumé", "NaïveRésumé", "naïve_résumé", "Naïve-Résumé"]],
  ["hello 世界", ["hello世界", "Hello 世界", "HELLO_世界", "hello.世界", "hello-世界", "Hello世界", "hello_世界", "Hello-世界"]],
  ["this is a much longer test string with many words to convert", ["thisIsAMuchLongerTestStringWithManyWordsToConvert", "This Is A Much Longer Test String With Many Words To Convert", "THIS_IS_A_MUCH_LONGER_TEST_STRING_WITH_MANY_WORDS_TO_CONVERT", "this.is.a.much.longer.test.string.with.many.words.to.convert", "this-is-a-much-longer-test-string-with-many-words-to-convert", "ThisIsAMuchLongerTestStringWithManyWordsToConvert", "this_is_a_much_longer_test_string_with_many_words_to_convert", "This-Is-A-Much-Longer-Test-String-With-Many-Words-To-Convert"]],
  ["thisIsAMuchLongerTestStringWithManyWordsToConvert", ["thisIsAMuchLongerTestStringWithManyWordsToConvert", "This Is A Much Longer Test String With Many Words To Convert", "THIS_IS_A_MUCH_LONGER_TEST_STRING_WITH_MANY_WORDS_TO_CONVERT", "this.is.a.much.longer.test.string.with.many.words.to.convert", "this-is-a-much-longer-test-string-with-many-words-to-convert", "ThisIsAMuchLongerTestStringWithManyWordsToConvert", "this_is_a_much_longer_test_string_with_many_words_to_convert", "This-Is-A-Much-Longer-Test-String-With-Many-Words-To-Convert"]],
  ["THIS_IS_A_MUCH_LONGER_TEST_STRING_WITH_MANY_WORDS_TO_CONVERT", ["thisIsAMuchLongerTestStringWithManyWordsToConvert", "This Is A Much Longer Test String With Many Words To Convert", "THIS_IS_A_MUCH_LONGER_TEST_STRING_WITH_MANY_WORDS_TO_CONVERT", "this.is.a.much.longer.test.string.with.many.words.to.convert", "this-is-a-much-longer-test-string-with-many-words-to-convert", "ThisIsAMuchLongerTestStringWithManyWordsToConvert", "this_is_a_much_longer_test_string_with_many_words_to_convert", "This-Is-A-Much-Longer-Test-String-With-Many-Words-To-Convert"]],
  ["9", ["9", "9", "9", "9", "9", "9", "9", "9"]],
  ["999", ["999", "999", "999", "999", "999", "999", "999", "999"]],
  ["hello world", ["helloWorld", "Hello World", "HELLO_WORLD", "hello.world", "hello-world", "HelloWorld", "hello_world", "Hello-World"]],
  ["FOO_BAR", ["fooBar", "Foo Bar", "FOO_BAR", "foo.bar", "foo-bar", "FooBar", "foo_bar", "Foo-Bar"]],
  ["already-kebab", ["alreadyKebab", "Already Kebab", "ALREADY_KEBAB", "already.kebab", "already-kebab", "AlreadyKebab", "already_kebab", "Already-Kebab"]],
  ["test 123", ["test_123", "Test 123", "TEST_123", "test.123", "test-123", "Test_123", "test_123", "Test-123"]],
  ["oneTwoThree", ["oneTwoThree", "One Two Three", "ONE_TWO_THREE", "one.two.three", "one-two-three", "OneTwoThree", "one_two_three", "One-Two-Three"]],
  ["OneTwoThree", ["oneTwoThree", "One Two Three", "ONE_TWO_THREE", "one.two.three", "one-two-three", "OneTwoThree", "one_two_three", "One-Two-Three"]],
  ["oneTWOThree", ["oneTwoThree", "One Two Three", "ONE_TWO_THREE", "one.two.three", "one-two-three", "OneTwoThree", "one_two_three", "One-Two-Three"]],
  ["ONETwoThree", ["oneTwoThree", "One Two Three", "ONE_TWO_THREE", "one.two.three", "one-two-three", "OneTwoThree", "one_two_three", "One-Two-Three"]],
  ["oneTwo3", ["oneTwo3", "One Two3", "ONE_TWO3", "one.two3", "one-two3", "OneTwo3", "one_two3", "One-Two3"]],
  ["one2Three", ["one2Three", "One2 Three", "ONE2_THREE", "one2.three", "one2-three", "One2Three", "one2_three", "One2-Three"]],
  ["one23", ["one23", "One23", "ONE23", "one23", "one23", "One23", "one23", "One23"]],
  ["oneABCTwo", ["oneAbcTwo", "One Abc Two", "ONE_ABC_TWO", "one.abc.two", "one-abc-two", "OneAbcTwo", "one_abc_two", "One-Abc-Two"]],
  ["a1B", ["a1B", "A1 B", "A1_B", "a1.b", "a1-b", "A1B", "a1_b", "A1-B"]],
  ["ABc", ["aBc", "A Bc", "A_BC", "a.bc", "a-bc", "ABc", "a_bc", "A-Bc"]],
  ["ABcD", ["aBcD", "A Bc D", "A_BC_D", "a.bc.d", "a-bc-d", "ABcD", "a_bc_d", "A-Bc-D"]],
  ["ABcDE", ["aBcDe", "A Bc De", "A_BC_DE", "a.bc.de", "a-bc-de", "ABcDe", "a_bc_de", "A-Bc-De"]],
  ["ß", ["ß", "SS", "SS", "ß", "ß", "SS", "ß", "SS"]],
  ["straße", ["straße", "Straße", "STRASSE", "straße", "straße", "Straße", "straße", "Straße"]],
  ["İ", ["i̇", "İ", "İ", "i̇", "i̇", "İ", "i̇", "İ"]],
  ["ﬀ", ["ﬀ", "FF", "FF", "ﬀ", "ﬀ", "FF", "ﬀ", "FF"]],
  ["ﬀoo bar", ["ﬀooBar", "FFoo Bar", "FFOO_BAR", "ﬀoo.bar", "ﬀoo-bar", "FFooBar", "ﬀoo_bar", "FFoo-Bar"]],
  ["ǅeněk", ["ǆeněk", "Ǆeněk", "ǄENĚK", "ǆeněk", "ǆeněk", "Ǆeněk", "ǆeněk", "Ǆeněk"]],
  ["Ångström", ["ångström", "Ångström", "ÅNGSTRÖM", "ångström", "ångström", "Ångström", "ångström", "Ångström"]],
  ["Müller", ["müller", "Müller", "MÜLLER", "müller", "müller", "Müller", "müller", "Müller"]],
  ["naïve", ["naïve", "Naïve", "NAÏVE", "naïve", "naïve", "Naïve", "naïve", "Naïve"]],
  ["foo bar", ["fooBar", "Foo Bar", "FOO_BAR", "foo.bar", "foo-bar", "FooBar", "foo_bar", "Foo-Bar"]],
  ["hello 👋 world", ["helloWorld", "Hello World", "HELLO_WORLD", "hello.world", "hello-world", "HelloWorld", "hello_world", "Hello-World"]],
  ["a_b_c", ["aBC", "A B C", "A_B_C", "a.b.c", "a-b-c", "ABC", "a_b_c", "A-B-C"]],
  ["A_B_C", ["aBC", "A B C", "A_B_C", "a.b.c", "a-b-c", "ABC", "a_b_c", "A-B-C"]],
  ["1.2.3", ["1_2_3", "1 2 3", "1_2_3", "1.2.3", "1-2-3", "1_2_3", "1_2_3", "1-2-3"]],
  ["foo2bar3baz", ["foo2bar3baz", "Foo2bar3baz", "FOO2BAR3BAZ", "foo2bar3baz", "foo2bar3baz", "Foo2bar3baz", "foo2bar3baz", "Foo2bar3baz"]],
  ["ABC123def", ["abc123def", "Abc123def", "ABC123DEF", "abc123def", "abc123def", "Abc123def", "abc123def", "Abc123def"]],
  ["test123test", ["test123test", "Test123test", "TEST123TEST", "test123test", "test123test", "Test123test", "test123test", "Test123test"]],
  ["x", ["x", "X", "X", "x", "x", "X", "x", "X"]],
  ["XY", ["xy", "Xy", "XY", "xy", "xy", "Xy", "xy", "Xy"]],
  ["Xy", ["xy", "Xy", "XY", "xy", "xy", "Xy", "xy", "Xy"]],
  ["xY", ["xY", "X Y", "X_Y", "x.y", "x-y", "XY", "x_y", "X-Y"]],
  ["AaBbCc", ["aaBbCc", "Aa Bb Cc", "AA_BB_CC", "aa.bb.cc", "aa-bb-cc", "AaBbCc", "aa_bb_cc", "Aa-Bb-Cc"]],
  ["AAbbCC", ["aAbbCc", "A Abb Cc", "A_ABB_CC", "a.abb.cc", "a-abb-cc", "AAbbCc", "a_abb_cc", "A-Abb-Cc"]],
  ["a--b__c..d", ["aBCD", "A B C D", "A_B_C_D", "a.b.c.d", "a-b-c-d", "ABCD", "a_b_c_d", "A-B-C-D"]],
  ["Ünicode Test", ["ünicodeTest", "Ünicode Test", "ÜNICODE_TEST", "ünicode.test", "ünicode-test", "ÜnicodeTest", "ünicode_test", "Ünicode-Test"]],
  ["Ñoño", ["ñoño", "Ñoño", "ÑOÑO", "ñoño", "ñoño", "Ñoño", "ñoño", "Ñoño"]],
  ["Œuvre", ["œuvre", "Œuvre", "ŒUVRE", "œuvre", "œuvre", "Œuvre", "œuvre", "Œuvre"]],
  ["ﬀoo", ["ﬀoo", "FFoo", "FFOO", "ﬀoo", "ﬀoo", "FFoo", "ﬀoo", "FFoo"]],
  ["Ǆeněk", ["ǆeněk", "Ǆeněk", "ǄENĚK", "ǆeněk", "ǆeněk", "Ǆeněk", "ǆeněk", "Ǆeněk"]],
  ["ǆeněk", ["ǆeněk", "Ǆeněk", "ǄENĚK", "ǆeněk", "ǆeněk", "Ǆeněk", "ǆeněk", "Ǆeněk"]],
  ["ǅeněk test", ["ǆeněkTest", "Ǆeněk Test", "ǄENĚK_TEST", "ǆeněk.test", "ǆeněk-test", "ǄeněkTest", "ǆeněk_test", "Ǆeněk-Test"]],
  ["ǈubav", ["ǉubav", "Ǉubav", "ǇUBAV", "ǉubav", "ǉubav", "Ǉubav", "ǉubav", "Ǉubav"]],
  ["ǉubav", ["ǉubav", "Ǉubav", "ǇUBAV", "ǉubav", "ǉubav", "Ǉubav", "ǉubav", "Ǉubav"]],
  ["Ǌegac", ["ǌegac", "Ǌegac", "ǊEGAC", "ǌegac", "ǌegac", "Ǌegac", "ǌegac", "Ǌegac"]],
  ["ǋegac", ["ǌegac", "Ǌegac", "ǊEGAC", "ǌegac", "ǌegac", "Ǌegac", "ǌegac", "Ǌegac"]],
  ["ﬁ", ["ﬁ", "FI", "FI", "ﬁ", "ﬁ", "FI", "ﬁ", "FI"]],
  ["ﬂ", ["ﬂ", "FL", "FL", "ﬂ", "ﬂ", "FL", "ﬂ", "FL"]],
  ["ﬀo", ["ﬀo", "FFo", "FFO", "ﬀo", "ﬀo", "FFo", "ﬀo", "FFo"]],
  ["ßa", ["ßa", "SSa", "SSA", "ßa", "ßa", "SSa", "ßa", "SSa"]],
  ["aßb", ["aßb", "Aßb", "ASSB", "aßb", "aßb", "Aßb", "aßb", "Aßb"]],
  ["ẞ", ["ß", "ẞ", "ẞ", "ß", "ß", "ẞ", "ß", "ẞ"]],
  ["ﬀﬀ", ["ﬀﬀ", "FFﬀ", "FFFF", "ﬀﬀ", "ﬀﬀ", "FFﬀ", "ﬀﬀ", "FFﬀ"]],
  ["ﬀ bar", ["ﬀBar", "FF Bar", "FF_BAR", "ﬀ.bar", "ﬀ-bar", "FFBar", "ﬀ_bar", "FF-Bar"]],
  ["ŉ", ["ŉ", "ʼN", "ʼN", "ŉ", "ŉ", "ʼN", "ŉ", "ʼN"]],
  ["ǰ", ["ǰ", "J̌", "J̌", "ǰ", "ǰ", "J̌", "ǰ", "J̌"]],
  ["ΐ", ["ΐ", "Ϊ́", "Ϊ́", "ΐ", "ΐ", "Ϊ́", "ΐ", "Ϊ́"]],
  ["ΰ", ["ΰ", "Ϋ́", "Ϋ́", "ΰ", "ΰ", "Ϋ́", "ΰ", "Ϋ́"]],
  ["և", ["և", "ԵՒ", "ԵՒ", "և", "և", "ԵՒ", "և", "ԵՒ"]],
  ["ա", ["ա", "Ա", "Ա", "ա", "ա", "Ա", "ա", "Ա"]],
  ["Ա", ["ա", "Ա", "Ա", "ա", "ա", "Ա", "ա", "Ա"]],
  ["Աբ", ["աբ", "Աբ", "ԱԲ", "աբ", "աբ", "Աբ", "աբ", "Աբ"]],
  ["ԱԲ", ["աբ", "Աբ", "ԱԲ", "աբ", "աբ", "Աբ", "աբ", "Աբ"]],
  ["աԲ", ["աԲ", "Ա Բ", "Ա_Բ", "ա.բ", "ա-բ", "ԱԲ", "ա_բ", "Ա-Բ"]],
  ["OʼBrien", ["oʼbrien", "Oʼbrien", "OʼBRIEN", "oʼbrien", "oʼbrien", "Oʼbrien", "oʼbrien", "Oʼbrien"]],
  ["HawaiʼiTest", ["hawaiʼiTest", "Hawaiʼi Test", "HAWAIʼI_TEST", "hawaiʼi.test", "hawaiʼi-test", "HawaiʼiTest", "hawaiʼi_test", "Hawaiʼi-Test"]],
  ["dʼArtagnan", ["dʼartagnan", "Dʼartagnan", "DʼARTAGNAN", "dʼartagnan", "dʼartagnan", "Dʼartagnan", "dʼartagnan", "Dʼartagnan"]],
  ["aʼB", ["aʼb", "Aʼb", "AʼB", "aʼb", "aʼb", "Aʼb", "aʼb", "Aʼb"]],
  ["Aʼb", ["aʼb", "Aʼb", "AʼB", "aʼb", "aʼb", "Aʼb", "aʼb", "Aʼb"]],
  ["ABʼc", ["abʼc", "Abʼc", "ABʼC", "abʼc", "abʼc", "Abʼc", "abʼc", "Abʼc"]],
  ["aʼ1B", ["aʼ1B", "Aʼ1 B", "Aʼ1_B", "aʼ1.b", "aʼ1-b", "Aʼ1B", "aʼ1_b", "Aʼ1-B"]],
  ["1ʼB", ["1ʼb", "1ʼb", "1ʼB", "1ʼb", "1ʼb", "1ʼb", "1ʼb", "1ʼb"]],
  ["AʼBCd", ["aʼbCd", "Aʼb Cd", "AʼB_CD", "aʼb.cd", "aʼb-cd", "AʼbCd", "aʼb_cd", "Aʼb-Cd"]],
  ["你好World", ["你好world", "你好world", "你好WORLD", "你好world", "你好world", "你好world", "你好world", "你好world"]],
  ["世A", ["世a", "世a", "世A", "世a", "世a", "世a", "世a", "世a"]],
  ["a世B", ["a世b", "A世b", "A世B", "a世b", "a世b", "A世b", "a世b", "A世b"]],
  ["hello世界Test", ["hello世界test", "Hello世界test", "HELLO世界TEST", "hello世界test", "hello世界test", "Hello世界test", "hello世界test", "Hello世界test"]],
  ["ABǅ", ["abǆ", "Abǆ", "ABǄ", "abǆ", "abǆ", "Abǆ", "abǆ", "Abǆ"]],
  ["Aǅb", ["aǆb", "Aǆb", "AǄB", "aǆb", "aǆb", "Aǆb", "aǆb", "Aǆb"]],
  ["ŒuvreTest", ["œuvreTest", "Œuvre Test", "ŒUVRE_TEST", "œuvre.test", "œuvre-test", "ŒuvreTest", "œuvre_test", "Œuvre-Test"]],
  ["ﬁsh", ["ﬁsh", "FIsh", "FISH", "ﬁsh", "ﬁsh", "FIsh", "ﬁsh", "FIsh"]],
  ["ﬁshTest", ["ﬁshTest", "FIsh Test", "FISH_TEST", "ﬁsh.test", "ﬁsh-test", "FIshTest", "ﬁsh_test", "FIsh-Test"]],
  ["aﬀB", ["aﬀB", "Aﬀ B", "AFF_B", "aﬀ.b", "aﬀ-b", "AﬀB", "aﬀ_b", "Aﬀ-B"]],
  ["ﬀooBar", ["ﬀooBar", "FFoo Bar", "FFOO_BAR", "ﬀoo.bar", "ﬀoo-bar", "FFooBar", "ﬀoo_bar", "FFoo-Bar"]],
  ["aﬀ", ["aﬀ", "Aﬀ", "AFF", "aﬀ", "aﬀ", "Aﬀ", "aﬀ", "Aﬀ"]],
  ["oʼbrien", ["oʼbrien", "Oʼbrien", "OʼBRIEN", "oʼbrien", "oʼbrien", "Oʼbrien", "oʼbrien", "Oʼbrien"]],
  ["OʼBRIEN", ["oʼbrien", "Oʼbrien", "OʼBRIEN", "oʼbrien", "oʼbrien", "Oʼbrien", "oʼbrien", "Oʼbrien"]],
  ["Hawaiʼi", ["hawaiʼi", "Hawaiʼi", "HAWAIʼI", "hawaiʼi", "hawaiʼi", "Hawaiʼi", "hawaiʼi", "Hawaiʼi"]],
  ["hawaiʼi", ["hawaiʼi", "Hawaiʼi", "HAWAIʼI", "hawaiʼi", "hawaiʼi", "Hawaiʼi", "hawaiʼi", "Hawaiʼi"]],
  ["ʼ", ["ʼ", "ʼ", "ʼ", "ʼ", "ʼ", "ʼ", "ʼ", "ʼ"]],
  ["ʼN", ["ʼn", "ʼn", "ʼN", "ʼn", "ʼn", "ʼn", "ʼn", "ʼn"]],
  ["ʼn", ["ʼn", "ʼn", "ʼN", "ʼn", "ʼn", "ʼn", "ʼn", "ʼn"]],
  ["aʼ", ["aʼ", "Aʼ", "Aʼ", "aʼ", "aʼ", "Aʼ", "aʼ", "Aʼ"]],
  ["ʼa", ["ʼa", "ʼa", "ʼA", "ʼa", "ʼa", "ʼa", "ʼa", "ʼa"]],
  ["foo bar", ["fooBar", "Foo Bar", "FOO_BAR", "foo.bar", "foo-bar", "FooBar", "foo_bar", "Foo-Bar"]],
  ["foo_bar", ["fooBar", "Foo Bar", "FOO_BAR", "foo.bar", "foo-bar", "FooBar", "foo_bar", "Foo-Bar"]],
  ["foo-bar", ["fooBar", "Foo Bar", "FOO_BAR", "foo.bar", "foo-bar", "FooBar", "foo_bar", "Foo-Bar"]],
  ["foo.bar", ["fooBar", "Foo Bar", "FOO_BAR", "foo.bar", "foo-bar", "FooBar", "foo_bar", "Foo-Bar"]],
  ["foo/bar", ["fooBar", "Foo Bar", "FOO_BAR", "foo.bar", "foo-bar", "FooBar", "foo_bar", "Foo-Bar"]],
  ["foo  bar", ["fooBar", "Foo Bar", "FOO_BAR", "foo.bar", "foo-bar", "FooBar", "foo_bar", "Foo-Bar"]],
  ["foo__bar", ["fooBar", "Foo Bar", "FOO_BAR", "foo.bar", "foo-bar", "FooBar", "foo_bar", "Foo-Bar"]],
  ["foo--bar", ["fooBar", "Foo Bar", "FOO_BAR", "foo.bar", "foo-bar", "FooBar", "foo_bar", "Foo-Bar"]],
];

// Round-trip expectations: ROUND_TRIPS[input][from][to] is the change-case
// value of to(from(input)).
// prettier-ignore
const ROUND_TRIPS: Record<string, Record<string, Record<string, string>>> = {"hello world":{"camelCase":{"camelCase":"helloWorld","capitalCase":"Hello World","constantCase":"HELLO_WORLD","dotCase":"hello.world","kebabCase":"hello-world","pascalCase":"HelloWorld","snakeCase":"hello_world","trainCase":"Hello-World"},"capitalCase":{"camelCase":"helloWorld","capitalCase":"Hello World","constantCase":"HELLO_WORLD","dotCase":"hello.world","kebabCase":"hello-world","pascalCase":"HelloWorld","snakeCase":"hello_world","trainCase":"Hello-World"},"constantCase":{"camelCase":"helloWorld","capitalCase":"Hello World","constantCase":"HELLO_WORLD","dotCase":"hello.world","kebabCase":"hello-world","pascalCase":"HelloWorld","snakeCase":"hello_world","trainCase":"Hello-World"},"dotCase":{"camelCase":"helloWorld","capitalCase":"Hello World","constantCase":"HELLO_WORLD","dotCase":"hello.world","kebabCase":"hello-world","pascalCase":"HelloWorld","snakeCase":"hello_world","trainCase":"Hello-World"},"kebabCase":{"camelCase":"helloWorld","capitalCase":"Hello World","constantCase":"HELLO_WORLD","dotCase":"hello.world","kebabCase":"hello-world","pascalCase":"HelloWorld","snakeCase":"hello_world","trainCase":"Hello-World"},"pascalCase":{"camelCase":"helloWorld","capitalCase":"Hello World","constantCase":"HELLO_WORLD","dotCase":"hello.world","kebabCase":"hello-world","pascalCase":"HelloWorld","snakeCase":"hello_world","trainCase":"Hello-World"},"snakeCase":{"camelCase":"helloWorld","capitalCase":"Hello World","constantCase":"HELLO_WORLD","dotCase":"hello.world","kebabCase":"hello-world","pascalCase":"HelloWorld","snakeCase":"hello_world","trainCase":"Hello-World"},"trainCase":{"camelCase":"helloWorld","capitalCase":"Hello World","constantCase":"HELLO_WORLD","dotCase":"hello.world","kebabCase":"hello-world","pascalCase":"HelloWorld","snakeCase":"hello_world","trainCase":"Hello-World"}},"fooBarBaz":{"camelCase":{"camelCase":"fooBarBaz","capitalCase":"Foo Bar Baz","constantCase":"FOO_BAR_BAZ","dotCase":"foo.bar.baz","kebabCase":"foo-bar-baz","pascalCase":"FooBarBaz","snakeCase":"foo_bar_baz","trainCase":"Foo-Bar-Baz"},"capitalCase":{"camelCase":"fooBarBaz","capitalCase":"Foo Bar Baz","constantCase":"FOO_BAR_BAZ","dotCase":"foo.bar.baz","kebabCase":"foo-bar-baz","pascalCase":"FooBarBaz","snakeCase":"foo_bar_baz","trainCase":"Foo-Bar-Baz"},"constantCase":{"camelCase":"fooBarBaz","capitalCase":"Foo Bar Baz","constantCase":"FOO_BAR_BAZ","dotCase":"foo.bar.baz","kebabCase":"foo-bar-baz","pascalCase":"FooBarBaz","snakeCase":"foo_bar_baz","trainCase":"Foo-Bar-Baz"},"dotCase":{"camelCase":"fooBarBaz","capitalCase":"Foo Bar Baz","constantCase":"FOO_BAR_BAZ","dotCase":"foo.bar.baz","kebabCase":"foo-bar-baz","pascalCase":"FooBarBaz","snakeCase":"foo_bar_baz","trainCase":"Foo-Bar-Baz"},"kebabCase":{"camelCase":"fooBarBaz","capitalCase":"Foo Bar Baz","constantCase":"FOO_BAR_BAZ","dotCase":"foo.bar.baz","kebabCase":"foo-bar-baz","pascalCase":"FooBarBaz","snakeCase":"foo_bar_baz","trainCase":"Foo-Bar-Baz"},"pascalCase":{"camelCase":"fooBarBaz","capitalCase":"Foo Bar Baz","constantCase":"FOO_BAR_BAZ","dotCase":"foo.bar.baz","kebabCase":"foo-bar-baz","pascalCase":"FooBarBaz","snakeCase":"foo_bar_baz","trainCase":"Foo-Bar-Baz"},"snakeCase":{"camelCase":"fooBarBaz","capitalCase":"Foo Bar Baz","constantCase":"FOO_BAR_BAZ","dotCase":"foo.bar.baz","kebabCase":"foo-bar-baz","pascalCase":"FooBarBaz","snakeCase":"foo_bar_baz","trainCase":"Foo-Bar-Baz"},"trainCase":{"camelCase":"fooBarBaz","capitalCase":"Foo Bar Baz","constantCase":"FOO_BAR_BAZ","dotCase":"foo.bar.baz","kebabCase":"foo-bar-baz","pascalCase":"FooBarBaz","snakeCase":"foo_bar_baz","trainCase":"Foo-Bar-Baz"}},"FOO_BAR":{"camelCase":{"camelCase":"fooBar","capitalCase":"Foo Bar","constantCase":"FOO_BAR","dotCase":"foo.bar","kebabCase":"foo-bar","pascalCase":"FooBar","snakeCase":"foo_bar","trainCase":"Foo-Bar"},"capitalCase":{"camelCase":"fooBar","capitalCase":"Foo Bar","constantCase":"FOO_BAR","dotCase":"foo.bar","kebabCase":"foo-bar","pascalCase":"FooBar","snakeCase":"foo_bar","trainCase":"Foo-Bar"},"constantCase":{"camelCase":"fooBar","capitalCase":"Foo Bar","constantCase":"FOO_BAR","dotCase":"foo.bar","kebabCase":"foo-bar","pascalCase":"FooBar","snakeCase":"foo_bar","trainCase":"Foo-Bar"},"dotCase":{"camelCase":"fooBar","capitalCase":"Foo Bar","constantCase":"FOO_BAR","dotCase":"foo.bar","kebabCase":"foo-bar","pascalCase":"FooBar","snakeCase":"foo_bar","trainCase":"Foo-Bar"},"kebabCase":{"camelCase":"fooBar","capitalCase":"Foo Bar","constantCase":"FOO_BAR","dotCase":"foo.bar","kebabCase":"foo-bar","pascalCase":"FooBar","snakeCase":"foo_bar","trainCase":"Foo-Bar"},"pascalCase":{"camelCase":"fooBar","capitalCase":"Foo Bar","constantCase":"FOO_BAR","dotCase":"foo.bar","kebabCase":"foo-bar","pascalCase":"FooBar","snakeCase":"foo_bar","trainCase":"Foo-Bar"},"snakeCase":{"camelCase":"fooBar","capitalCase":"Foo Bar","constantCase":"FOO_BAR","dotCase":"foo.bar","kebabCase":"foo-bar","pascalCase":"FooBar","snakeCase":"foo_bar","trainCase":"Foo-Bar"},"trainCase":{"camelCase":"fooBar","capitalCase":"Foo Bar","constantCase":"FOO_BAR","dotCase":"foo.bar","kebabCase":"foo-bar","pascalCase":"FooBar","snakeCase":"foo_bar","trainCase":"Foo-Bar"}},"XMLParser":{"camelCase":{"camelCase":"xmlParser","capitalCase":"Xml Parser","constantCase":"XML_PARSER","dotCase":"xml.parser","kebabCase":"xml-parser","pascalCase":"XmlParser","snakeCase":"xml_parser","trainCase":"Xml-Parser"},"capitalCase":{"camelCase":"xmlParser","capitalCase":"Xml Parser","constantCase":"XML_PARSER","dotCase":"xml.parser","kebabCase":"xml-parser","pascalCase":"XmlParser","snakeCase":"xml_parser","trainCase":"Xml-Parser"},"constantCase":{"camelCase":"xmlParser","capitalCase":"Xml Parser","constantCase":"XML_PARSER","dotCase":"xml.parser","kebabCase":"xml-parser","pascalCase":"XmlParser","snakeCase":"xml_parser","trainCase":"Xml-Parser"},"dotCase":{"camelCase":"xmlParser","capitalCase":"Xml Parser","constantCase":"XML_PARSER","dotCase":"xml.parser","kebabCase":"xml-parser","pascalCase":"XmlParser","snakeCase":"xml_parser","trainCase":"Xml-Parser"},"kebabCase":{"camelCase":"xmlParser","capitalCase":"Xml Parser","constantCase":"XML_PARSER","dotCase":"xml.parser","kebabCase":"xml-parser","pascalCase":"XmlParser","snakeCase":"xml_parser","trainCase":"Xml-Parser"},"pascalCase":{"camelCase":"xmlParser","capitalCase":"Xml Parser","constantCase":"XML_PARSER","dotCase":"xml.parser","kebabCase":"xml-parser","pascalCase":"XmlParser","snakeCase":"xml_parser","trainCase":"Xml-Parser"},"snakeCase":{"camelCase":"xmlParser","capitalCase":"Xml Parser","constantCase":"XML_PARSER","dotCase":"xml.parser","kebabCase":"xml-parser","pascalCase":"XmlParser","snakeCase":"xml_parser","trainCase":"Xml-Parser"},"trainCase":{"camelCase":"xmlParser","capitalCase":"Xml Parser","constantCase":"XML_PARSER","dotCase":"xml.parser","kebabCase":"xml-parser","pascalCase":"XmlParser","snakeCase":"xml_parser","trainCase":"Xml-Parser"}},"getHTTPSURL":{"camelCase":{"camelCase":"getHttpsurl","capitalCase":"Get Httpsurl","constantCase":"GET_HTTPSURL","dotCase":"get.httpsurl","kebabCase":"get-httpsurl","pascalCase":"GetHttpsurl","snakeCase":"get_httpsurl","trainCase":"Get-Httpsurl"},"capitalCase":{"camelCase":"getHttpsurl","capitalCase":"Get Httpsurl","constantCase":"GET_HTTPSURL","dotCase":"get.httpsurl","kebabCase":"get-httpsurl","pascalCase":"GetHttpsurl","snakeCase":"get_httpsurl","trainCase":"Get-Httpsurl"},"constantCase":{"camelCase":"getHttpsurl","capitalCase":"Get Httpsurl","constantCase":"GET_HTTPSURL","dotCase":"get.httpsurl","kebabCase":"get-httpsurl","pascalCase":"GetHttpsurl","snakeCase":"get_httpsurl","trainCase":"Get-Httpsurl"},"dotCase":{"camelCase":"getHttpsurl","capitalCase":"Get Httpsurl","constantCase":"GET_HTTPSURL","dotCase":"get.httpsurl","kebabCase":"get-httpsurl","pascalCase":"GetHttpsurl","snakeCase":"get_httpsurl","trainCase":"Get-Httpsurl"},"kebabCase":{"camelCase":"getHttpsurl","capitalCase":"Get Httpsurl","constantCase":"GET_HTTPSURL","dotCase":"get.httpsurl","kebabCase":"get-httpsurl","pascalCase":"GetHttpsurl","snakeCase":"get_httpsurl","trainCase":"Get-Httpsurl"},"pascalCase":{"camelCase":"getHttpsurl","capitalCase":"Get Httpsurl","constantCase":"GET_HTTPSURL","dotCase":"get.httpsurl","kebabCase":"get-httpsurl","pascalCase":"GetHttpsurl","snakeCase":"get_httpsurl","trainCase":"Get-Httpsurl"},"snakeCase":{"camelCase":"getHttpsurl","capitalCase":"Get Httpsurl","constantCase":"GET_HTTPSURL","dotCase":"get.httpsurl","kebabCase":"get-httpsurl","pascalCase":"GetHttpsurl","snakeCase":"get_httpsurl","trainCase":"Get-Httpsurl"},"trainCase":{"camelCase":"getHttpsurl","capitalCase":"Get Httpsurl","constantCase":"GET_HTTPSURL","dotCase":"get.httpsurl","kebabCase":"get-httpsurl","pascalCase":"GetHttpsurl","snakeCase":"get_httpsurl","trainCase":"Get-Httpsurl"}},"test_string":{"camelCase":{"camelCase":"testString","capitalCase":"Test String","constantCase":"TEST_STRING","dotCase":"test.string","kebabCase":"test-string","pascalCase":"TestString","snakeCase":"test_string","trainCase":"Test-String"},"capitalCase":{"camelCase":"testString","capitalCase":"Test String","constantCase":"TEST_STRING","dotCase":"test.string","kebabCase":"test-string","pascalCase":"TestString","snakeCase":"test_string","trainCase":"Test-String"},"constantCase":{"camelCase":"testString","capitalCase":"Test String","constantCase":"TEST_STRING","dotCase":"test.string","kebabCase":"test-string","pascalCase":"TestString","snakeCase":"test_string","trainCase":"Test-String"},"dotCase":{"camelCase":"testString","capitalCase":"Test String","constantCase":"TEST_STRING","dotCase":"test.string","kebabCase":"test-string","pascalCase":"TestString","snakeCase":"test_string","trainCase":"Test-String"},"kebabCase":{"camelCase":"testString","capitalCase":"Test String","constantCase":"TEST_STRING","dotCase":"test.string","kebabCase":"test-string","pascalCase":"TestString","snakeCase":"test_string","trainCase":"Test-String"},"pascalCase":{"camelCase":"testString","capitalCase":"Test String","constantCase":"TEST_STRING","dotCase":"test.string","kebabCase":"test-string","pascalCase":"TestString","snakeCase":"test_string","trainCase":"Test-String"},"snakeCase":{"camelCase":"testString","capitalCase":"Test String","constantCase":"TEST_STRING","dotCase":"test.string","kebabCase":"test-string","pascalCase":"TestString","snakeCase":"test_string","trainCase":"Test-String"},"trainCase":{"camelCase":"testString","capitalCase":"Test String","constantCase":"TEST_STRING","dotCase":"test.string","kebabCase":"test-string","pascalCase":"TestString","snakeCase":"test_string","trainCase":"Test-String"}},"Test String":{"camelCase":{"camelCase":"testString","capitalCase":"Test String","constantCase":"TEST_STRING","dotCase":"test.string","kebabCase":"test-string","pascalCase":"TestString","snakeCase":"test_string","trainCase":"Test-String"},"capitalCase":{"camelCase":"testString","capitalCase":"Test String","constantCase":"TEST_STRING","dotCase":"test.string","kebabCase":"test-string","pascalCase":"TestString","snakeCase":"test_string","trainCase":"Test-String"},"constantCase":{"camelCase":"testString","capitalCase":"Test String","constantCase":"TEST_STRING","dotCase":"test.string","kebabCase":"test-string","pascalCase":"TestString","snakeCase":"test_string","trainCase":"Test-String"},"dotCase":{"camelCase":"testString","capitalCase":"Test String","constantCase":"TEST_STRING","dotCase":"test.string","kebabCase":"test-string","pascalCase":"TestString","snakeCase":"test_string","trainCase":"Test-String"},"kebabCase":{"camelCase":"testString","capitalCase":"Test String","constantCase":"TEST_STRING","dotCase":"test.string","kebabCase":"test-string","pascalCase":"TestString","snakeCase":"test_string","trainCase":"Test-String"},"pascalCase":{"camelCase":"testString","capitalCase":"Test String","constantCase":"TEST_STRING","dotCase":"test.string","kebabCase":"test-string","pascalCase":"TestString","snakeCase":"test_string","trainCase":"Test-String"},"snakeCase":{"camelCase":"testString","capitalCase":"Test String","constantCase":"TEST_STRING","dotCase":"test.string","kebabCase":"test-string","pascalCase":"TestString","snakeCase":"test_string","trainCase":"Test-String"},"trainCase":{"camelCase":"testString","capitalCase":"Test String","constantCase":"TEST_STRING","dotCase":"test.string","kebabCase":"test-string","pascalCase":"TestString","snakeCase":"test_string","trainCase":"Test-String"}},"already-kebab":{"camelCase":{"camelCase":"alreadyKebab","capitalCase":"Already Kebab","constantCase":"ALREADY_KEBAB","dotCase":"already.kebab","kebabCase":"already-kebab","pascalCase":"AlreadyKebab","snakeCase":"already_kebab","trainCase":"Already-Kebab"},"capitalCase":{"camelCase":"alreadyKebab","capitalCase":"Already Kebab","constantCase":"ALREADY_KEBAB","dotCase":"already.kebab","kebabCase":"already-kebab","pascalCase":"AlreadyKebab","snakeCase":"already_kebab","trainCase":"Already-Kebab"},"constantCase":{"camelCase":"alreadyKebab","capitalCase":"Already Kebab","constantCase":"ALREADY_KEBAB","dotCase":"already.kebab","kebabCase":"already-kebab","pascalCase":"AlreadyKebab","snakeCase":"already_kebab","trainCase":"Already-Kebab"},"dotCase":{"camelCase":"alreadyKebab","capitalCase":"Already Kebab","constantCase":"ALREADY_KEBAB","dotCase":"already.kebab","kebabCase":"already-kebab","pascalCase":"AlreadyKebab","snakeCase":"already_kebab","trainCase":"Already-Kebab"},"kebabCase":{"camelCase":"alreadyKebab","capitalCase":"Already Kebab","constantCase":"ALREADY_KEBAB","dotCase":"already.kebab","kebabCase":"already-kebab","pascalCase":"AlreadyKebab","snakeCase":"already_kebab","trainCase":"Already-Kebab"},"pascalCase":{"camelCase":"alreadyKebab","capitalCase":"Already Kebab","constantCase":"ALREADY_KEBAB","dotCase":"already.kebab","kebabCase":"already-kebab","pascalCase":"AlreadyKebab","snakeCase":"already_kebab","trainCase":"Already-Kebab"},"snakeCase":{"camelCase":"alreadyKebab","capitalCase":"Already Kebab","constantCase":"ALREADY_KEBAB","dotCase":"already.kebab","kebabCase":"already-kebab","pascalCase":"AlreadyKebab","snakeCase":"already_kebab","trainCase":"Already-Kebab"},"trainCase":{"camelCase":"alreadyKebab","capitalCase":"Already Kebab","constantCase":"ALREADY_KEBAB","dotCase":"already.kebab","kebabCase":"already-kebab","pascalCase":"AlreadyKebab","snakeCase":"already_kebab","trainCase":"Already-Kebab"}},"version 1.2.10":{"camelCase":{"camelCase":"version_1_2_10","capitalCase":"Version 1 2 10","constantCase":"VERSION_1_2_10","dotCase":"version.1.2.10","kebabCase":"version-1-2-10","pascalCase":"Version_1_2_10","snakeCase":"version_1_2_10","trainCase":"Version-1-2-10"},"capitalCase":{"camelCase":"version_1_2_10","capitalCase":"Version 1 2 10","constantCase":"VERSION_1_2_10","dotCase":"version.1.2.10","kebabCase":"version-1-2-10","pascalCase":"Version_1_2_10","snakeCase":"version_1_2_10","trainCase":"Version-1-2-10"},"constantCase":{"camelCase":"version_1_2_10","capitalCase":"Version 1 2 10","constantCase":"VERSION_1_2_10","dotCase":"version.1.2.10","kebabCase":"version-1-2-10","pascalCase":"Version_1_2_10","snakeCase":"version_1_2_10","trainCase":"Version-1-2-10"},"dotCase":{"camelCase":"version_1_2_10","capitalCase":"Version 1 2 10","constantCase":"VERSION_1_2_10","dotCase":"version.1.2.10","kebabCase":"version-1-2-10","pascalCase":"Version_1_2_10","snakeCase":"version_1_2_10","trainCase":"Version-1-2-10"},"kebabCase":{"camelCase":"version_1_2_10","capitalCase":"Version 1 2 10","constantCase":"VERSION_1_2_10","dotCase":"version.1.2.10","kebabCase":"version-1-2-10","pascalCase":"Version_1_2_10","snakeCase":"version_1_2_10","trainCase":"Version-1-2-10"},"pascalCase":{"camelCase":"version_1_2_10","capitalCase":"Version 1 2 10","constantCase":"VERSION_1_2_10","dotCase":"version.1.2.10","kebabCase":"version-1-2-10","pascalCase":"Version_1_2_10","snakeCase":"version_1_2_10","trainCase":"Version-1-2-10"},"snakeCase":{"camelCase":"version_1_2_10","capitalCase":"Version 1 2 10","constantCase":"VERSION_1_2_10","dotCase":"version.1.2.10","kebabCase":"version-1-2-10","pascalCase":"Version_1_2_10","snakeCase":"version_1_2_10","trainCase":"Version-1-2-10"},"trainCase":{"camelCase":"version_1_2_10","capitalCase":"Version 1 2 10","constantCase":"VERSION_1_2_10","dotCase":"version.1.2.10","kebabCase":"version-1-2-10","pascalCase":"Version_1_2_10","snakeCase":"version_1_2_10","trainCase":"Version-1-2-10"}}};

// Double-conversion expectations for a focused set (change-case is not
// idempotent everywhere, e.g. constantCase("123test") is "123TEST" but
// constantCase("123TEST") is "123_TEST").
// prettier-ignore
const DOUBLE: [string, [string, string, string, string, string, string, string, string]][] = [
  ["hello world", ["helloWorld", "Hello World", "HELLO_WORLD", "hello.world", "hello-world", "HelloWorld", "hello_world", "Hello-World"]],
  ["fooBarBaz", ["fooBarBaz", "Foo Bar Baz", "FOO_BAR_BAZ", "foo.bar.baz", "foo-bar-baz", "FooBarBaz", "foo_bar_baz", "Foo-Bar-Baz"]],
  ["FOO_BAR_BAZ", ["fooBarBaz", "Foo Bar Baz", "FOO_BAR_BAZ", "foo.bar.baz", "foo-bar-baz", "FooBarBaz", "foo_bar_baz", "Foo-Bar-Baz"]],
  ["XMLParser", ["xmlParser", "Xml Parser", "XML_PARSER", "xml.parser", "xml-parser", "XmlParser", "xml_parser", "Xml-Parser"]],
  ["test 123", ["test_123", "Test 123", "TEST_123", "test.123", "test-123", "Test_123", "test_123", "Test-123"]],
  ["café latte", ["caféLatte", "Café Latte", "CAFÉ_LATTE", "café.latte", "café-latte", "CaféLatte", "café_latte", "Café-Latte"]],
  ["version 1.2.10", ["version_1_2_10", "Version 1 2 10", "VERSION_1_2_10", "version.1.2.10", "version-1-2-10", "Version_1_2_10", "version_1_2_10", "Version-1-2-10"]],
  ["123test", ["123test", "123test", "123_TEST", "123test", "123test", "123test", "123test", "123test"]],
  ["123", ["123", "123", "123", "123", "123", "123", "123", "123"]],
  ["123 456", ["123_456", "123 456", "123_456", "123.456", "123-456", "123_456", "123_456", "123-456"]],
  ["1.2.3", ["1_2_3", "1 2 3", "1_2_3", "1.2.3", "1-2-3", "1_2_3", "1_2_3", "1-2-3"]],
  ["test123", ["test123", "Test123", "TEST123", "test123", "test123", "Test123", "test123", "Test123"]],
  ["1st place", ["1stPlace", "1st Place", "1_ST_PLACE", "1st.place", "1st-place", "1stPlace", "1st_place", "1st-Place"]],
  ["v2beta1", ["v2beta1", "V2beta1", "V2_BETA1", "v2beta1", "v2beta1", "V2beta1", "v2beta1", "V2beta1"]],
  ["a1b2c3", ["a1b2c3", "A1b2c3", "A1_B2_C3", "a1b2c3", "a1b2c3", "A1b2c3", "a1b2c3", "A1b2c3"]],
  ["ES6Module", ["es6Module", "Es6 Module", "ES6_MODULE", "es6.module", "es6-module", "Es6Module", "es6_module", "Es6-Module"]],
  ["utf8Decode", ["utf8Decode", "Utf8 Decode", "UTF8_DECODE", "utf8.decode", "utf8-decode", "Utf8Decode", "utf8_decode", "Utf8-Decode"]],
  ["base64Encode", ["base64Encode", "Base64 Encode", "BASE64_ENCODE", "base64.encode", "base64-encode", "Base64Encode", "base64_encode", "Base64-Encode"]],
  ["h1Element", ["h1Element", "H1 Element", "H1_ELEMENT", "h1.element", "h1-element", "H1Element", "h1_element", "H1-Element"]],
  ["int32Array", ["int32Array", "Int32 Array", "INT32_ARRAY", "int32.array", "int32-array", "Int32Array", "int32_array", "Int32-Array"]],
];

describe("case-change", () => {
  // Main compatibility matrix: every function x every input.
  for (const caseName of CASE_NAMES) {
    const bunFn = bunFns[caseName];
    const index = CASE_NAMES.indexOf(caseName);

    describe(caseName, () => {
      for (const [input, expected] of EXPECTED) {
        test(`${JSON.stringify(input)} => ${JSON.stringify(expected[index])}`, () => {
          expect(bunFn(input)).toBe(expected[index]);
        });
      }
    });
  }

  // Cross-conversion round-trips: convert from A to B, compare against
  // change-case's value for the same chain.
  describe("cross-conversion round-trips", () => {
    for (const input of Object.keys(ROUND_TRIPS)) {
      for (const from of CASE_NAMES) {
        for (const to of CASE_NAMES) {
          test(`${from}(${JSON.stringify(input)}) => ${to}`, () => {
            const bunIntermediate = bunFns[from](input);
            expect(bunFns[to](bunIntermediate)).toBe(ROUND_TRIPS[input][from][to]);
          });
        }
      }
    }
  });

  // Double-conversion stability: converting the output again matches
  // change-case's own double conversion.
  describe("double conversion", () => {
    for (const [input, expected] of DOUBLE) {
      for (const caseName of CASE_NAMES) {
        const index = CASE_NAMES.indexOf(caseName);
        test(`${caseName}(${caseName}(${JSON.stringify(input)}))`, () => {
          expect(bunFns[caseName](bunFns[caseName](input))).toBe(expected[index]);
        });
      }
    }
  });

  // Specific per-function expected values (hardcoded, not generated).
  describe("specific expected values", () => {
    test("camelCase", () => {
      expect(Bun.camelCase("foo bar")).toBe("fooBar");
      expect(Bun.camelCase("foo-bar")).toBe("fooBar");
      expect(Bun.camelCase("foo_bar")).toBe("fooBar");
      expect(Bun.camelCase("FOO_BAR")).toBe("fooBar");
      expect(Bun.camelCase("FooBar")).toBe("fooBar");
      expect(Bun.camelCase("fooBar")).toBe("fooBar");
      expect(Bun.camelCase("")).toBe("");
      expect(Bun.camelCase("foo")).toBe("foo");
      expect(Bun.camelCase("A")).toBe("a");
    });

    test("pascalCase", () => {
      expect(Bun.pascalCase("foo bar")).toBe("FooBar");
      expect(Bun.pascalCase("foo-bar")).toBe("FooBar");
      expect(Bun.pascalCase("foo_bar")).toBe("FooBar");
      expect(Bun.pascalCase("FOO_BAR")).toBe("FooBar");
      expect(Bun.pascalCase("fooBar")).toBe("FooBar");
      expect(Bun.pascalCase("")).toBe("");
      expect(Bun.pascalCase("foo")).toBe("Foo");
    });

    test("snakeCase", () => {
      expect(Bun.snakeCase("foo bar")).toBe("foo_bar");
      expect(Bun.snakeCase("fooBar")).toBe("foo_bar");
      expect(Bun.snakeCase("FooBar")).toBe("foo_bar");
      expect(Bun.snakeCase("FOO_BAR")).toBe("foo_bar");
      expect(Bun.snakeCase("foo-bar")).toBe("foo_bar");
      expect(Bun.snakeCase("")).toBe("");
    });

    test("kebabCase", () => {
      expect(Bun.kebabCase("foo bar")).toBe("foo-bar");
      expect(Bun.kebabCase("fooBar")).toBe("foo-bar");
      expect(Bun.kebabCase("FooBar")).toBe("foo-bar");
      expect(Bun.kebabCase("FOO_BAR")).toBe("foo-bar");
      expect(Bun.kebabCase("foo_bar")).toBe("foo-bar");
      expect(Bun.kebabCase("")).toBe("");
    });

    test("constantCase", () => {
      expect(Bun.constantCase("foo bar")).toBe("FOO_BAR");
      expect(Bun.constantCase("fooBar")).toBe("FOO_BAR");
      expect(Bun.constantCase("FooBar")).toBe("FOO_BAR");
      expect(Bun.constantCase("foo-bar")).toBe("FOO_BAR");
      expect(Bun.constantCase("foo_bar")).toBe("FOO_BAR");
      expect(Bun.constantCase("")).toBe("");
    });

    test("dotCase", () => {
      expect(Bun.dotCase("foo bar")).toBe("foo.bar");
      expect(Bun.dotCase("fooBar")).toBe("foo.bar");
      expect(Bun.dotCase("FOO_BAR")).toBe("foo.bar");
      expect(Bun.dotCase("")).toBe("");
    });

    test("capitalCase", () => {
      expect(Bun.capitalCase("foo bar")).toBe("Foo Bar");
      expect(Bun.capitalCase("fooBar")).toBe("Foo Bar");
      expect(Bun.capitalCase("FOO_BAR")).toBe("Foo Bar");
      expect(Bun.capitalCase("")).toBe("");
    });

    test("trainCase", () => {
      expect(Bun.trainCase("foo bar")).toBe("Foo-Bar");
      expect(Bun.trainCase("fooBar")).toBe("Foo-Bar");
      expect(Bun.trainCase("FOO_BAR")).toBe("Foo-Bar");
      expect(Bun.trainCase("")).toBe("");
    });
  });

  // Edge cases
  describe("edge cases", () => {
    test("empty string returns empty for all functions", () => {
      for (const caseName of CASE_NAMES) {
        expect(bunFns[caseName]("")).toBe("");
      }
    });

    test("single character", () => {
      for (const ch of ["a", "A", "z", "Z", "0", "9"]) {
        for (const caseName of CASE_NAMES) {
          const row = EXPECTED.find(([input]) => input === ch)!;
          expect(bunFns[caseName](ch)).toBe(row[CASE_NAMES.indexOf(caseName) + 1]);
        }
      }
    });

    test("all separators produce empty for all functions", () => {
      for (const sep of ["---", "___", "...", "   ", "\t\t", "-_.-_."]) {
        for (const caseName of CASE_NAMES) {
          expect(bunFns[caseName](sep)).toBe("");
        }
      }
    });

    test("unicode strings", () => {
      for (const input of ["café latte", "naïve résumé", "hello 世界"]) {
        for (const caseName of CASE_NAMES) {
          const row = EXPECTED.find(([i]) => i === input)!;
          expect(bunFns[caseName](input)).toBe(row[CASE_NAMES.indexOf(caseName) + 1]);
        }
      }
    });

    test("acronym splitting", () => {
      // These specifically test the upper -> upper+lower boundary rule.
      for (const input of [
        "XMLParser",
        "HTMLElement",
        "innerHTML",
        "XMLHttpRequest",
        "getURLParams",
        "isHTTPS",
        "CSSStyleSheet",
        "IOError",
        "UIKit",
        "HTTPSConnection",
        "myXMLParser",
        "getDBConnection",
        "setHTTPSEnabled",
        "ABCDef",
        "ABCdef",
      ]) {
        for (const caseName of CASE_NAMES) {
          const row = EXPECTED.find(([i]) => i === input)!;
          expect(bunFns[caseName](input)).toBe(row[CASE_NAMES.indexOf(caseName) + 1]);
        }
      }
    });

    test("digit-prefix underscore in camelCase/pascalCase", () => {
      // change-case inserts _ before digit-starting words (index > 0) in camel/pascal.
      const input = "version 1.2.10";
      expect(Bun.camelCase(input)).toBe("version_1_2_10");
      expect(Bun.pascalCase(input)).toBe("Version_1_2_10");
      // snake/kebab/etc should NOT have the _ prefix.
      expect(Bun.snakeCase(input)).toBe("version_1_2_10");
      expect(Bun.kebabCase(input)).toBe("version-1-2-10");
    });

    test("long strings", () => {
      const long = "this is a much longer test string with many words to convert";
      const camelLong = "thisIsAMuchLongerTestStringWithManyWordsToConvert";
      for (const input of [long, camelLong]) {
        const row = EXPECTED.find(([i]) => i === input)!;
        for (const caseName of CASE_NAMES) {
          expect(bunFns[caseName](input)).toBe(row[CASE_NAMES.indexOf(caseName) + 1]);
        }
      }
    });

    test("repeated single word", () => {
      expect(Bun.camelCase("foo")).toBe("foo");
      expect(Bun.pascalCase("foo")).toBe("Foo");
      expect(Bun.snakeCase("foo")).toBe("foo");
      expect(Bun.kebabCase("foo")).toBe("foo");
      expect(Bun.constantCase("foo")).toBe("FOO");
    });

    test("single uppercase word", () => {
      expect(Bun.camelCase("FOO")).toBe("foo");
      expect(Bun.pascalCase("FOO")).toBe("Foo");
      expect(Bun.snakeCase("FOO")).toBe("foo");
    });
  });

  // Error handling: a non-string argument throws a TypeError.
  describe("error handling", () => {
    const invalid = (message: string) =>
      expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE", message });

    for (const caseName of CASE_NAMES) {
      const fn = bunFns[caseName];

      test(`${caseName}() with no arguments throws`, () => {
        // @ts-expect-error
        expect(() => fn()).toThrow(invalid("input must be a string"));
      });

      test(`${caseName}(123) with number throws`, () => {
        // @ts-expect-error
        expect(() => fn(123)).toThrow(invalid("input must be a string"));
      });

      test(`${caseName}(null) throws`, () => {
        // @ts-expect-error
        expect(() => fn(null)).toThrow(invalid("input must be a string"));
      });

      test(`${caseName}(undefined) throws`, () => {
        // @ts-expect-error
        expect(() => fn(undefined)).toThrow(invalid("input must be a string"));
      });

      test(`${caseName}({}) with object throws`, () => {
        // @ts-expect-error
        expect(() => fn({})).toThrow(invalid("input must be a string"));
      });

      test(`${caseName}([]) with array throws`, () => {
        // @ts-expect-error
        expect(() => fn([])).toThrow(invalid("input must be a string"));
      });

      test(`${caseName}(true) with boolean throws`, () => {
        // @ts-expect-error
        expect(() => fn(true)).toThrow(invalid("input must be a string"));
      });

      test(`${caseName}(new String("foo")) with a String object throws`, () => {
        // @ts-expect-error
        expect(() => fn(new String("foo"))).toThrow(invalid("input must be a string"));
      });
    }
  });

  // Ensure .length property is 1
  describe("function.length", () => {
    for (const caseName of CASE_NAMES) {
      test(`Bun.${caseName}.length === 1`, () => {
        expect(bunFns[caseName].length).toBe(1);
      });
    }
  });

  // Stress test with generated inputs
  describe("generated inputs", () => {
    // Words joined with various separators
    const words = ["foo", "bar", "baz", "qux"];
    const separators = [" ", "_", "-", ".", "/", "  ", "__", "--"];

    for (const sep of separators) {
      const input = words.join(sep);
      test(`words joined by ${JSON.stringify(sep)}: ${JSON.stringify(input)}`, () => {
        const row = EXPECTED.find(([i]) => i === input)!;
        for (const caseName of CASE_NAMES) {
          expect(bunFns[caseName](input)).toBe(row[CASE_NAMES.indexOf(caseName) + 1]);
        }
      });
    }

    // Various camelCase-style inputs
    const camelInputs = [
      "oneTwoThree",
      "OneTwoThree",
      "oneTWOThree",
      "ONETwoThree",
      "oneTwo3",
      "one2Three",
      "one23",
      "oneABCTwo",
    ];

    for (const input of camelInputs) {
      test(`camelCase-style: ${JSON.stringify(input)}`, () => {
        for (const caseName of CASE_NAMES) {
          const row = EXPECTED.find(([i]) => i === input)!;
          expect(bunFns[caseName](input)).toBe(row[CASE_NAMES.indexOf(caseName) + 1]);
        }
      });
    }
  });
});
