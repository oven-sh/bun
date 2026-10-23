import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { featureNamed } from "../../../scripts/build/trim/features.ts";
import { demangleMsvcDeclaration, demangleMsvcName, isMsvcName } from "../../../scripts/build/trim/msvc-names.ts";
import { Demangler } from "../../../scripts/build/trim/report.ts";
import { model, run, skipNotice } from "./toy-program.ts";

const constructs = `using size_t = decltype(sizeof 0);
namespace std { using nullptr_t = decltype(nullptr); }
void* operator new(size_t, void* place) noexcept;
namespace Toy {
enum class Color { Red };
union Either { int number; float real; };
struct Plain { int field; int method(int) const; };
struct Base { virtual ~Base(); virtual int run(int); int value; };
struct Other { virtual ~Other(); virtual int stop(); int value; };
struct Derived : Base, Other { Derived(); Derived(const Derived&); ~Derived() override; int run(int) override; int stop() override;
  static int count; static int make(Derived*, Derived*, const Derived&);
  bool operator==(const Derived&) const; int operator()(int, ...) volatile; int& operator[](size_t) &; operator bool() const&&; Derived& operator=(Derived&&) noexcept;
  void* operator new(size_t); void operator delete(void*); void* operator new[](size_t); };
template<bool secure, typename Data = int> struct Socket { int write(const char*, int); static Socket* adopt(Socket<!secure, Data>*); template<typename T> T as(T) const; };
template<int number, unsigned long long big, Color color> struct Numbers { static int sum(); };
template<auto value> int constant() { return 0; }
template<typename... Types> int all(Types...) { return sizeof...(Types); }
template<int (*function)(int)> int calls(int x) { return function(x); }
template<int Plain::*member, int (Plain::*method)(int) const> int reads(const Plain& plain) { return plain.*member + (plain.*method)(1); }
template<typename Signature> struct Function;
template<typename Result, typename... Arguments> struct Function<Result(Arguments...)> { Result operator()(Arguments...) const; };
namespace { int hidden(int x) { return x + 1; } struct Secret { int open(); }; int Secret::open() { return 2; } }
int plain(int);
int plain(int x) { return x; }
int (*returnsFunction(char, signed char, unsigned char))(short, unsigned short) { return nullptr; }
int takesEverything(bool, wchar_t, char8_t, char16_t, char32_t, long, unsigned long, long long, unsigned long long, float, double, long double, std::nullptr_t) { return 0; }
int takesPointers(const int*, volatile int* const, int&, int&&, const Plain* const, int (&)[4], int (*)[2][3], Color, Either, int Plain::*, int (Plain::*)(int) const, void (*)() noexcept) { return 0; }
int repeats(Socket<true>*, Socket<true>*, Socket<false, Plain>&, Socket<false, Plain>&, Plain, Plain) { return 0; }
int variadic(const char*, ...) { return 0; }
int usesLocals(int x) { static Derived once; static thread_local int perThread = plain(x); auto lambda = [&](int y) { static int calls; return ++calls + y + perThread; }; return lambda(x) + once.Base::value; }
extern "C" int c_function(int x) { static Derived inC; return x + inC.Base::value; }
long double operator""_toy(long double x) { return x; }
decltype(auto) deduced(int x) { return x; }
auto alsoDeduced(Plain* plain) { return plain; }
int Derived::count = plain(3);
Derived global;
const int table[3] = { 1, 2, 3 };
int (*const natives[2])(int) = { plain, hidden };
extern const Plain* const volatile pointer = nullptr;
int Plain::* memberPointer = &Plain::field;
Base::~Base() {} int Base::run(int x) { return x; } Other::~Other() {} int Other::stop() { return 0; }
Derived::Derived() {} Derived::Derived(const Derived&) {} Derived::~Derived() {} int Derived::run(int x) { return x; } int Derived::stop() { return 1; }
int Derived::make(Derived*, Derived*, const Derived&) { return 0; }
bool Derived::operator==(const Derived&) const { return true; } int Derived::operator()(int, ...) volatile { return 0; } int& Derived::operator[](size_t) & { return Base::value; }
Derived::operator bool() const&& { return true; } Derived& Derived::operator=(Derived&&) noexcept { return *this; }
void* Derived::operator new(size_t) { return &global; } void Derived::operator delete(void*) {} void* Derived::operator new[](size_t) { return &global; }
int Plain::method(int x) const { return x; }
template<bool secure, typename Data> int Socket<secure, Data>::write(const char*, int) { return secure; }
template<bool secure, typename Data> Socket<secure, Data>* Socket<secure, Data>::adopt(Socket<!secure, Data>*) { return nullptr; }
template<bool secure, typename Data> template<typename T> T Socket<secure, Data>::as(T value) const { return value; }
template<int number, unsigned long long big, Color color> int Numbers<number, big, color>::sum() { return number; }
template<typename Result, typename... Arguments> Result Function<Result(Arguments...)>::operator()(Arguments...) const { return Result(); }
template struct Socket<true>; template struct Socket<false, Plain>; template struct Numbers<-5, 0xffffffffffffffffull, Color::Red>; template struct Numbers<0, 16, Color::Red>; template struct Numbers<10, 11, Color::Red>;
template int Socket<true>::as<int>(int) const; template Socket<false>* Socket<true>::as<Socket<false>*>(Socket<false>*) const;
template int constant<7>(); template int constant<true>(); template int constant<'x'>(); template int constant<&table>(); template int constant<&plain>(); template int constant<&Plain::field>(); template int constant<nullptr>();
template int all<>(); template int all<int, Plain, Function<int(Plain&, const char*)>>(int, Plain, Function<int(Plain&, const char*)>);
template int calls<plain>(int); template int reads<&Plain::field, &Plain::method>(const Plain&);
template struct Function<int(Plain&, const char*)>; template struct Function<void()>;
int uses() { Secret secret; return secret.open() + hidden(1) + natives[0](1); }
}
`;

const namesAndParameters: [mangled: string, text: string][] = [
  ["?$S1@?1??usesLocals@Toy@@YAHH@Z@4IA", "`int __cdecl Toy::usesLocals(int)'::`2'::$S1"],
  ["?$TSS0@?1??c_function@Toy@@9@4HA", "`extern \"C\" Toy::c_function'::`2'::$TSS0"],
  ["??$all@$$V@Toy@@YAHXZ", "Toy::all<>(void)"],
  [
    "??$all@HUPlain@Toy@@U?$Function@$$A6AHAEAUPlain@Toy@@PEBD@Z@2@@Toy@@YAHHUPlain@0@U?$Function@$$A6AHAEAUPlain@Toy@@PEBD@Z@0@@Z",
    "Toy::all<int, Toy::Plain, Toy::Function<int (Toy::Plain &, char const *)>>(int, Toy::Plain, Toy::Function<int (Toy::Plain &, char const *)>)",
  ],
  ["??$as@H@?$Socket@$00H@Toy@@QEBAHH@Z", "Toy::Socket<1, int>::as<int>(int) const"],
  [
    "??$as@PEAU?$Socket@$0A@H@Toy@@@?$Socket@$00H@Toy@@QEBAPEAU?$Socket@$0A@H@1@PEAU21@@Z",
    "Toy::Socket<1, int>::as<Toy::Socket<0, int> *>(Toy::Socket<0, int> *) const",
  ],
  ["??$calls@$1?plain@Toy@@YAHH@Z@Toy@@YAHH@Z", "Toy::calls<&Toy::plain(int)>(int)"],
  ["??$constant@$M$$T0A@@Toy@@YAHXZ", "Toy::constant<0>(void)"],
  ["??$constant@$MD0HI@@Toy@@YAHXZ", "Toy::constant<120>(void)"],
  ["??$constant@$MH06@Toy@@YAHXZ", "Toy::constant<7>(void)"],
  ["??$constant@$MP6AHH@Z1?plain@Toy@@YAHH@Z@Toy@@YAHXZ", "Toy::constant<&Toy::plain(int)>(void)"],
  ["??$constant@$MPEQPlain@Toy@@H0A@@Toy@@YAHXZ", "Toy::constant<0>(void)"],
  ["??$constant@$M_N00@Toy@@YAHXZ", "Toy::constant<1>(void)"],
  [
    "??$reads@$0A@$1?method@Plain@Toy@@QEBAHH@Z@Toy@@YAHAEBUPlain@0@@Z",
    "Toy::reads<0, &Toy::Plain::method(int) const>(Toy::Plain const &)",
  ],
  ["??0Derived@Toy@@QEAA@AEBU01@@Z", "Toy::Derived::Derived(Toy::Derived const &)"],
  ["??1Derived@Toy@@UEAA@XZ", "Toy::Derived::~Derived(void)"],
  ["??2Derived@Toy@@SAPEAX_K@Z", "Toy::Derived::operator new(unsigned __int64)"],
  ["??3Derived@Toy@@SAXPEAX@Z", "Toy::Derived::operator delete(void *)"],
  ["??4Derived@Toy@@QEAAAEAU01@$$QEAU01@@Z", "Toy::Derived::operator=(Toy::Derived &&)"],
  ["??8Derived@Toy@@QEBA_NAEBU01@@Z", "Toy::Derived::operator==(Toy::Derived const &) const"],
  ["??ADerived@Toy@@QEGAAAEAH_K@Z", "Toy::Derived::operator[](unsigned __int64) &"],
  ["??BDerived@Toy@@QEHBA_NXZ", "Toy::Derived::operator bool(void) const &&"],
  [
    "??R<lambda_0>@?0??usesLocals@Toy@@YAHH@Z@QEBA?A?<auto>@@H@Z",
    "`int __cdecl Toy::usesLocals(int)'::`1'::<lambda_0>::operator()(int) const",
  ],
  [
    "??R?$Function@$$A6AHAEAUPlain@Toy@@PEBD@Z@Toy@@QEBAHAEAUPlain@1@PEBD@Z",
    "Toy::Function<int (Toy::Plain &, char const *)>::operator()(Toy::Plain &, char const *) const",
  ],
  ["??RDerived@Toy@@QECAHHZZ", "Toy::Derived::operator()(int, ...) volatile"],
  ["??_7Derived@Toy@@6BBase@1@@", "const Toy::Derived::`vftable'{for `Toy::Base'}"],
  ["??_EDerived@Toy@@WBA@EAAPEAXI@Z", "[thunk]: Toy::Derived::`vector deleting dtor'`adjustor{16}'(unsigned int)"],
  ["??_GDerived@Toy@@UEAAPEAXI@Z", "Toy::Derived::`scalar deleting dtor'(unsigned int)"],
  ["??_R4Derived@Toy@@6BBase@1@@", "const Toy::Derived::`RTTI Complete Object Locator'{for `Toy::Base'}"],
  ["??_UDerived@Toy@@SAPEAX_K@Z", "Toy::Derived::operator new[](unsigned __int64)"],
  ["??__E?count@Derived@Toy@@2HA@@YAXXZ", "`dynamic initializer for `Toy::Derived::count''(void)"],
  ["??__Eglobal@Toy@@YAXXZ", "`dynamic initializer for 'Toy::global''(void)"],
  ["??__Fglobal@Toy@@YAXXZ", "`dynamic atexit destructor for 'Toy::global''(void)"],
  [
    "??__FinC@?1??c_function@Toy@@9@YAXXZ",
    "`dynamic atexit destructor for '`extern \"C\" Toy::c_function'::`2'::inC''(void)",
  ],
  ["??__K_toy@Toy@@YAOO@Z", 'Toy::operator ""_toy(long double)'],
  ["?adopt@?$Socket@$00H@Toy@@SAPEAU12@PEAU?$Socket@$0A@H@2@@Z", "Toy::Socket<1, int>::adopt(Toy::Socket<0, int> *)"],
  ["?alsoDeduced@Toy@@YA@PEAUPlain@1@@Z", "Toy::alsoDeduced(Toy::Plain *)"],
  [
    "?calls@?1???R<lambda_0>@?0??usesLocals@Toy@@YAHH@Z@QEBA?A?<auto>@@H@Z@4HA",
    "`public: <auto> __cdecl `int __cdecl Toy::usesLocals(int)'::`1'::<lambda_0>::operator()(int) const'::`2'::calls",
  ],
  ["?count@Derived@Toy@@2HA", "Toy::Derived::count"],
  ["?global@Toy@@3UDerived@1@A", "Toy::global"],
  ["?hidden@?A0x1E492250@Toy@@YAHH@Z", "Toy::`anonymous namespace'::hidden(int)"],
  ["?inC@?1??c_function@Toy@@9@4UDerived@2@A", "`extern \"C\" Toy::c_function'::`2'::inC"],
  [
    "?make@Derived@Toy@@SAHPEAU12@0AEBU12@@Z",
    "Toy::Derived::make(Toy::Derived *, Toy::Derived *, Toy::Derived const &)",
  ],
  ["?memberPointer@Toy@@3PEQPlain@1@HEQ21@", "Toy::memberPointer"],
  ["?method@Plain@Toy@@QEBAHH@Z", "Toy::Plain::method(int) const"],
  ["?natives@Toy@@3QBQ6AHH@ZB", "Toy::natives"],
  ["?open@Secret@?A0x1E492250@Toy@@QEAAHXZ", "Toy::`anonymous namespace'::Secret::open(void)"],
  ["?plain@Toy@@YAHH@Z", "Toy::plain(int)"],
  ["?pointer@Toy@@3SEBUPlain@1@EB", "Toy::pointer"],
  [
    "?repeats@Toy@@YAHPEAU?$Socket@$00H@1@0AEAU?$Socket@$0A@UPlain@Toy@@@1@1UPlain@1@2@Z",
    "Toy::repeats(Toy::Socket<1, int> *, Toy::Socket<1, int> *, Toy::Socket<0, Toy::Plain> &, Toy::Socket<0, Toy::Plain> &, Toy::Plain, Toy::Plain)",
  ],
  ["?returnsFunction@Toy@@YAP6AHFG@ZDCE@Z", "Toy::returnsFunction(char, signed char, unsigned char)"],
  ["?sum@?$Numbers@$09$0L@$0A@@Toy@@SAHXZ", "Toy::Numbers<10, 11, 0>::sum(void)"],
  ["?sum@?$Numbers@$0?4$0?0$0A@@Toy@@SAHXZ", "Toy::Numbers<-5, -1, 0>::sum(void)"],
  ["?sum@?$Numbers@$0A@$0BA@$0A@@Toy@@SAHXZ", "Toy::Numbers<0, 16, 0>::sum(void)"],
  [
    "?takesEverything@Toy@@YAH_N_W_Q_S_UJK_J_KMNO$$T@Z",
    "Toy::takesEverything(bool, wchar_t, char8_t, char16_t, char32_t, long, unsigned long, __int64, unsigned __int64, float, double, long double, std::nullptr_t)",
  ],
  [
    "?takesPointers@Toy@@YAHPEBHQECHAEAH$$QEAHQEBUPlain@1@AEAY03HPEAY112HW4Color@1@TEither@1@PEQ21@HP821@EBAHH@ZP6AXX_E@Z",
    "Toy::takesPointers(int const *, int volatile *const, int &, int &&, Toy::Plain const *const, int (&)[4], int (*)[2][3], Toy::Color, Toy::Either, int Toy::Plain::*, int (Toy::Plain::*)(int) const, void (*)(void) noexcept)",
  ],
  ["?variadic@Toy@@YAHPEBDZZ", "Toy::variadic(char const *, ...)"],
  ["?write@?$Socket@$00H@Toy@@QEAAHPEBDH@Z", "Toy::Socket<1, int>::write(char const *, int)"],
  ["??_R0?AUDerived@Toy@@@8", "`RTTI Type Descriptor'"],
  ["??_R1BA@?0A@EA@Other@Toy@@8", "Toy::Other::`RTTI Base Class Descriptor at (16, -1, 0, 64)'"],
  ["??_R2Derived@Toy@@8", "Toy::Derived::`RTTI Base Class Array'"],
  ["??_R3Derived@Toy@@8", "Toy::Derived::`RTTI Class Hierarchy Descriptor'"],
];

const declarations: [mangled: string, text: string][] = [
  ["?plain@Toy@@YAHH@Z", "int __cdecl Toy::plain(int)"],
  [
    "?make@Derived@Toy@@SAHPEAU12@0AEBU12@@Z",
    "public: static int __cdecl Toy::Derived::make(struct Toy::Derived *, struct Toy::Derived *, struct Toy::Derived const &)",
  ],
  ["?run@Derived@Toy@@UEAAHH@Z", "public: virtual int __cdecl Toy::Derived::run(int)"],
  [
    "?returnsFunction@Toy@@YAP6AHFG@ZDCE@Z",
    "int (__cdecl * __cdecl Toy::returnsFunction(char, signed char, unsigned char))(short, unsigned short)",
  ],
  ["?natives@Toy@@3QBQ6AHH@ZB", "int (__cdecl *const *const Toy::natives)(int)"],
  ["?count@Derived@Toy@@2HA", "public: static int Toy::Derived::count"],
  ["?memberPointer@Toy@@3PEQPlain@1@HEQ21@", "int Toy::Plain::*Toy::memberPointer"],
  ["?pointer@Toy@@3SEBUPlain@1@EB", "struct Toy::Plain const *const volatile Toy::pointer"],
  [
    "??_EDerived@Toy@@WBA@EAAPEAXI@Z",
    "[thunk]: public: virtual void * __cdecl Toy::Derived::`vector deleting dtor'`adjustor{16}'(unsigned int)",
  ],
  ["??_R0?AUDerived@Toy@@@8", "struct Toy::Derived `RTTI Type Descriptor'"],
];

describe("demangleMsvcName", () => {
  test.each(namesAndParameters)("%s", (mangled, text) => {
    expect(demangleMsvcName(mangled)).toBe(text);
  });

  test("what ThinLTO writes behind the name of a function or variable that it made visible to other modules is no part of it", () => {
    expect(demangleMsvcName("?plain@Toy@@YAHH@Z.llvm.1234567890")).toBe("Toy::plain(int)");
    expect(demangleMsvcName("?natives@Toy@@3QBQ6AHH@ZB.llvm.42")).toBe("Toy::natives");
  });

  test.each([
    ["a string literal", "??_C@_05CJBACGMB@hello@"],
    ["the MD5 of a name that was too long", "??@a6a285da2eea70dba6b578022be61d81@"],
    ["a C name", "entered"],
    ["an Itanium name", "_ZN3Toy5plainEi"],
    ["a name that ends in its scope", "?plain@Toy@"],
    ["a name that ends in its parameters", "?plain@Toy@@YAHH"],
    ["a reference to a name that was not there", "?plain@3@YAHH@Z"],
    ["a reference to a parameter that was not there", "?plain@Toy@@YAH0@Z"],
    ["a type that does not exist", "?plain@Toy@@YAH_0@Z"],
    ["nothing", ""],
  ])("does not read %s", (_, name) => {
    expect(demangleMsvcName(name)).toBeUndefined();
  });
});

describe("demangleMsvcDeclaration", () => {
  test.each(declarations)("%s", (mangled, text) => {
    expect(demangleMsvcDeclaration(mangled)).toBe(text);
  });
});

describe("every name that clang gives a sampler of C++", () => {
  const tools = Object.fromEntries(["clang", "llvm-nm", "llvm-undname"].map(name => [name, Bun.which(name)]));
  const missing = Object.keys(tools).filter(name => tools[name] === null);
  if (missing.length > 0)
    skipNotice("msvc-names.test.ts", `${missing.join(", ")} not on PATH: nothing is compared with llvm-undname`);

  async function demangledByLlvm(folder: string, names: string[]): Promise<(string | undefined)[]> {
    const { stdout } = await run([tools["llvm-undname"]!, ...names], folder);
    const lines = stdout.split("\n");
    const texts: (string | undefined)[] = [];
    for (let at = 0; texts.length < names.length; at += lines[at + 1] === "" ? 2 : 3) {
      expect(lines[at]).toBe(names[texts.length]!);
      texts.push(lines[at + 1] === "" ? undefined : lines[at + 1]);
    }
    return texts;
  }

  test.skipIf(missing.length > 0).each([
    ["x86_64", "-fno-rtti"],
    ["aarch64", "-fno-rtti"],
    ["x86_64", "-frtti"],
  ])("for %s with %s reads as llvm-undname reads it", async (machine, rtti) => {
    using dir = tempDir("trim-msvc-names", { "constructs.cpp": constructs });
    const folder = String(dir);
    const flags = [`--target=${machine}-pc-windows-msvc`, "-std=c++23", "-ffreestanding", "-fno-exceptions", rtti];
    const compiled = await run([tools.clang!, ...flags, "-c", "constructs.cpp", "-o", "constructs.obj"], folder);
    expect(compiled).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    const listed = await run([tools["llvm-nm"]!, "--no-sort", "--format=just-symbols", "constructs.obj"], folder);
    const names = [...new Set(listed.stdout.split("\n").filter(isMsvcName))];
    expect(names.length).toBeGreaterThan(70);
    expect(names.map(demangleMsvcDeclaration)).toEqual(await demangledByLlvm(folder, names));
    expect(names.map(demangleMsvcName)).not.toContain(undefined);
  });
});

describe("Demangler", () => {
  test("reads MSVC names itself, with no tool", () => {
    const names = ["?plain@Toy@@YAHH@Z", "entered", "??_C@_05CJBACGMB@hello@", "?plain@Toy@@YAHH@Z"];
    expect(new Demangler(undefined).demangle(names)).toEqual([
      "Toy::plain(int)",
      "entered",
      "??_C@_05CJBACGMB@hello@",
      "Toy::plain(int)",
    ]);
  });

  const cxxfilt = Bun.which("llvm-cxxfilt");
  test.skipIf(cxxfilt === null)("gives the tool the other names only", () => {
    expect(new Demangler(cxxfilt!).demangle(["_ZN3Toy5plainEi", "?plain@Toy@@YAHH@Z", "entered"])).toEqual([
      "Toy::plain(int)",
      "Toy::plain(int)",
      "entered",
    ]);
  });
});

describe("the pattern for what serves TLS", () => {
  const patterns = featureNamed(model, "TlsSockets").cxxFunctions!.map(({ pattern }) => new RegExp(pattern));
  const matches = (text: string) => patterns.some(pattern => pattern.test(text));

  test("takes the instantiation for TLS as either ABI spells it, and not the other", () => {
    expect(matches("uWS::HttpResponse<true>::end()")).toBe(true);
    expect(matches("uWS::HttpResponse<false>::end()")).toBe(false);
    // The Microsoft ABI writes a bool as a number.
    expect(demangleMsvcName("?end@?$HttpResponse@$00@uWS@@QEAAXXZ")).toBe("uWS::HttpResponse<1>::end(void)");
    expect(matches("uWS::HttpResponse<1>::end(void)")).toBe(true);
    expect(matches(demangleMsvcName("?end@?$HttpResponse@$0A@@uWS@@QEAAXXZ")!)).toBe(false);
    expect(matches(demangleMsvcName("?upgrade@Toy@@YAXPEAU?$WebSocket@$00$00H@uWS@@@Z")!)).toBe(true);
  });
});
