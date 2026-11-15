import { describe, expect, test } from "bun:test";
import { featureNamed } from "../../../scripts/build/trim/features.ts";
import { Demangler } from "../../../scripts/build/trim/report.ts";
import { model, skipNotice } from "./toy-program.ts";

const namesAndParameters: [mangled: string, text: string][] = [
  ["?$S1@?1??usesLocals@Toy@@YAHH@Z@4IA", "`int __cdecl Toy::usesLocals(int)'::`2'::$S1"],
  ["?$TSS0@?1??c_function@Toy@@9@4HA", "`extern \"C\" Toy::c_function'::`2'::$TSS0"],
  ["??$all@$$V@Toy@@YAHXZ", "Toy::all<>(void)"],
  [
    "??$all@HUPlain@Toy@@U?$Function@$$A6AHAEAUPlain@Toy@@PEBD@Z@2@@Toy@@YAHHUPlain@0@U?$Function@$$A6AHAEAUPlain@Toy@@PEBD@Z@0@@Z",
    "Toy::all<int, Toy::Plain, Toy::Function<(Toy::Plain &, char const *)>>(int, Toy::Plain, Toy::Function<(Toy::Plain &, char const *)>)",
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
    "Toy::Function<(Toy::Plain &, char const *)>::operator()(Toy::Plain &, char const *) const",
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
    "Toy::takesPointers(int const *, int volatile *const, int &, int &&, Toy::Plain const *const, int (&)[4], int (*)[2][3], Toy::Color, Toy::Either, int Toy::Plain::*, int (__cdecl Toy::Plain::*)(int) const, void (__cdecl *)(void) noexcept)",
  ],
  ["?variadic@Toy@@YAHPEBDZZ", "Toy::variadic(char const *, ...)"],
  ["?write@?$Socket@$00H@Toy@@QEAAHPEBDH@Z", "Toy::Socket<1, int>::write(char const *, int)"],
  ["??_R0?AUDerived@Toy@@@8", "`RTTI Type Descriptor'"],
  ["??_R1BA@?0A@EA@Other@Toy@@8", "Toy::Other::`RTTI Base Class Descriptor at (16, -1, 0, 64)'"],
  ["??_R2Derived@Toy@@8", "Toy::Derived::`RTTI Base Class Array'"],
  ["??_R3Derived@Toy@@8", "Toy::Derived::`RTTI Class Hierarchy Descriptor'"],
];

const cxxfilt = Bun.which("llvm-cxxfilt");
const canDemangle = cxxfilt !== null && Bun.which("llvm-undname") !== null;
if (!canDemangle) skipNotice("msvc-names.test.ts", "llvm-cxxfilt and llvm-undname are not both on PATH");
const demangle = (...names: string[]) => new Demangler(cxxfilt!).demangle(names);

describe.skipIf(!canDemangle)("Demangler", () => {
  test("reads the names of the Microsoft ABI as their qualified names and parameters", () => {
    expect(demangle(...namesAndParameters.map(([mangled]) => mangled))).toEqual(
      namesAndParameters.map(([, text]) => text),
    );
  });

  test("what ThinLTO writes behind the name of a function or variable that it made visible to other modules is no part of it", () => {
    expect(demangle("?plain@Toy@@YAHH@Z.llvm.1234567890", "?natives@Toy@@3QBQ6AHH@ZB.llvm.42")).toEqual([
      "Toy::plain(int)",
      "Toy::natives",
    ]);
  });

  test("leaves a name that cannot be read as it is, and those behind it in step", () => {
    expect(demangle("?plain@Toy@", "?plain@Toy@@YAHH@Z", "?plain@Toy@@YAH_0@Z", "?count@Derived@Toy@@2HA")).toEqual([
      "?plain@Toy@",
      "Toy::plain(int)",
      "?plain@Toy@@YAH_0@Z",
      "Toy::Derived::count",
    ]);
  });

  test("gives each tool its own names", () => {
    expect(demangle("_ZN3Toy5plainEi", "?plain@Toy@@YAHH@Z", "entered")).toEqual([
      "Toy::plain(int)",
      "Toy::plain(int)",
      "entered",
    ]);
  });
});

test("without a tool every name stays as it is", () => {
  expect(new Demangler(undefined).demangle(["?plain@Toy@@YAHH@Z", "entered"])).toEqual([
    "?plain@Toy@@YAHH@Z",
    "entered",
  ]);
});

describe.skipIf(!canDemangle)("the pattern for what serves TLS", () => {
  const patterns = featureNamed(model, "TlsSockets").cxxFunctions!.map(({ pattern }) => new RegExp(pattern));
  const matches = (text: string) => patterns.some(pattern => pattern.test(text));

  test("takes the instantiation for TLS as either ABI spells it, and not the other", () => {
    expect(matches("uWS::HttpResponse<true>::end()")).toBe(true);
    expect(matches("uWS::HttpResponse<false>::end()")).toBe(false);
    // The Microsoft ABI writes a bool as a number.
    expect(demangle("?end@?$HttpResponse@$00@uWS@@QEAAXXZ")).toEqual(["uWS::HttpResponse<1>::end(void)"]);
    expect(matches("uWS::HttpResponse<1>::end(void)")).toBe(true);
    expect(matches(demangle("?end@?$HttpResponse@$0A@@uWS@@QEAAXXZ")[0]!)).toBe(false);
    expect(matches(demangle("?upgrade@Toy@@YAXPEAU?$WebSocket@$00$00H@uWS@@@Z")[0]!)).toBe(true);
  });
});
