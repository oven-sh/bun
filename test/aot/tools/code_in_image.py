#!/usr/bin/env python3
"""code_in_image.py <executable> <command>: reads the compiled image of an executable built with `bun build --compile --aot`. It only reads the file and runs nothing.
From an offset into the image's code: the function, its written name, the file:line:column of the call site at a return address, and the frames inlined there; the pattern of a compiled regular expression.
  info                        the header, the sections, the tables, the parts of the code
  functions [text]            every function of the image: offset, size, name, file:line:column; with a text, those whose name or file holds it
  at <hexadecimal offset> ..  one address a line, counted from the start of the code part
As a module: Image(path).function_at(offset) -> (index, start, end); .describe(index) -> (name, path, line, column); .stack_at(index, offset in the function); .regexp_at(offset in the code of the regular expressions).
The forms it reads: aot/image/AOTImageFormat.h, AOTPositionTable.cpp, AOTCallSiteTable.cpp, AOTImageText.h, aot/object/AOTProgramTables.h, aot/runtime/AOTRegExpRecord.h. Whoever adds, removes or moves a section or a table changes SECTIONS and
TABLES here: test/aot/code-addresses-have-names.test.ts holds the answers against a program whose functions it knows.
Identical bodies are stored once: such a body has the name of one of its functions, so trust the caller's line and column. The image lists the addresses of some stubs only: shared code is named by the listed stub in front of it and the distance."""
import bisect, mmap, struct, sys

SECTIONS = ['Functions', 'FunctionStarts', 'CodeGranules', 'InnerEntries', 'Frames', 'FrameMaps', 'ClosureWords', 'Positions', 'FaultSites', 'SideTables', 'SharedCodeCopies', 'Strings', 'LongStrings', 'Text', 'Identifiers',
            'StringConstants', 'StringHeaders', 'RegExps', 'RegExpHashes', 'RegExpDetails', 'WebAssemblyDirectory', 'ProgramTables', 'StubAddresses', 'StubReturnSites', 'SlotHandlers', 'MethodLookups', 'MethodTable']
TABLES = ['types', 'typeSites', 'layouts', 'classes', 'layoutSets', 'allocations', 'constructedAllocations', 'shapeSetBits', 'propertyRuns', 'fieldTable', 'fieldRecordIndices', 'classMemberRows', 'classAccessors', 'methodTableFunctions',
          'methodLookupFunctions', 'methodTableDependents', 'removedFields', 'addedNames', 'classPrototypeNames', 'parsedRecordFields',
          'functionNames', 'functionNameGroups', 'functionNameRuns', 'functionRecordNumbers', 'functionRecords', 'functionRecordsByFunction', 'functionSources', 'implementedBuiltins', 'closureFunctionKinds', 'functionLengths',
          'closureCaptureCounts', 'functionsWithLargeCounts', 'closureCellNumbers', 'functionTexts', 'constructors', 'boundFunctions', 'constructEntrypoints',
          'staticsLayout', 'staticsRuns', 'staticsRoots', 'staticsNarrowRoots', 'staticsClearedEachCollection', 'functionVariables', 'identifiersByHash', 'identifiersOfEngineSymbols', 'keyCellIdentifiers', 'literalStrings',
          'literalStringTable', 'literalStringLimits', 'literalStringDigests', 'bigIntConstants', 'data', 'requests', 'builtinCells', 'eagerBuiltinCells', 'constantBuiltinMembers', 'globalBindings', 'entryPoints',
          'modules', 'moduleDirectories', 'moduleDisplayPaths', 'moduleRequests', 'linkRequests', 'evaluationRequests', 'entryPointLinkPlan', 'linkPlanRoots', 'linkPlanStepsOfRoots', 'moduleExports', 'indirectExports',
          'syntheticExports', 'requiredNames', 'moduleFailures', 'modulesByPath', 'modulesOfUncompiledCode', 'compiledRuntimeModules', 'compiledRuntimeFunctions']

def zigzag(v): return (v >> 1) ^ -(v & 1)

class Image:
    def __init__(self, path):
        f = open(path, 'rb'); self.m = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ); m = self.m
        self.base = None; at = 0
        while True:
            at = m.find(b'BUNAOT01', at)
            if at < 0: break
            size, code_offset, code_size = struct.unpack_from('<QQQ', m, at + 32); version = struct.unpack_from('<I', m, at + 72)[0]
            if version == 2 and code_offset + code_size <= size <= len(m) - at and code_size: self.base = at; break
            at += 8
        if self.base is None: raise SystemExit('no image in ' + path)
        b = self.base
        self.size, self.code_offset, self.code_size, self.address, self.executable_size = struct.unpack_from('<QQQQQ', m, b + 32)
        self.sections = {n: struct.unpack_from('<II', m, b + 208 + 8 * i) for i, n in enumerate(SECTIONS)}
        o = b + 208 + 8 * len(SECTIONS)
        self.n_functions, self.max_regexp_output = struct.unpack_from('<II', m, o)
        names = ['functionsEnd', 'codeGranuleShift', 'sharedCodeSize', 'webAssemblyCodeOffset', 'webAssemblyCodeSize', 'ffiCodeOffset', 'ffiCodeSize', 'regExpCodeOffset', 'constantsOffset', 'constantsSize']
        self.code = dict(zip(names, struct.unpack_from('<10I', m, o + 8))); self.flags = struct.unpack_from('<I', m, o + 48)[0]
        so, ss = self.sections['FunctionStarts']; self.starts = struct.unpack_from('<%dI' % (ss // 4), m, b + so)
        fo, fs = self.sections['Functions']; w = struct.unpack_from('<%dI' % (fs // 4), m, b + fo); self.side = w[0::2]; self.fn = [x & 0xffffff for x in w[1::2]]; self.fflags = [x >> 24 for x in w[1::2]]
        co, cs = self.sections['SharedCodeCopies']; self.copies = struct.unpack_from('<%dI' % (cs // 4), m, b + co)
        self.unit = None
        po, ps = self.sections['ProgramTables']; self.pt = b + po
        assert struct.unpack_from('<I', m, self.pt)[0] == 0x44505943, 'program tables: bad magic'
        r = self.pt + 8 + 16 + 20 + 12
        self.tables = {n: struct.unpack_from('<II', m, r + 8 * i) for i, n in enumerate(TABLES)}
        self.closure_first, self.closure_end = struct.unpack_from('<II', m, self.pt + 8 + 16 + 20)
        self._positions = None; self._modules = None; self._cache = {}; self._stubs = None; self._regexps = None; self._bodies = None

    def sec(self, name): o, s = self.sections[name]; return self.base + o, s
    def tab(self, name): o, c = self.tables[name]; return self.pt + o, c
    def n24(self, at): m = self.m; return m[at] | m[at + 1] << 8 | m[at + 2] << 16
    def varint(self, at):
        v = 0; sh = 0; m = self.m
        while True:
            c = m[at]; at += 1; v |= (c & 0x7f) << sh; sh += 7
            if not c & 0x80: return v, at

    # ---- text
    def text(self, string):
        m = self.m; so, ss = self.sec('Strings')
        if string * 4 >= ss: return '?string %d' % string
        word = struct.unpack_from('<I', m, so + 4 * string)[0]
        if not word: return ''
        number = word & 0xffffff; lo, _ = self.sec('LongStrings'); to, _ = self.sec('Text'); ho, hs = self.sec('StringHeaders')
        def listed(i):
            w = struct.unpack_from('<I', m, lo + 4 * i)[0]
            if w & 0xff: return w >> 8, w & 0xff
            return struct.unpack_from('<II', m, lo + 4 * i + 4)
        if word & (1 << 27): off, length = listed(number)
        elif self.pic():
            r, hf = struct.unpack_from('<II', m, ho + 8 * number)
            if r & 0xff: off, length = r >> 8, r & 0xff
            elif not hf: off, length = 0, 0
            else: off, length = listed(r >> 8)
        else:
            _, length, chars = struct.unpack_from('<IIQ', m, ho + 24 * number); off = chars - (self.address + self.sections['Text'][0]) if length else 0
        if word & (1 << 24): return m[to + off:to + off + 2 * length].decode('utf-16-le', 'replace')
        return m[to + off:to + off + length].decode('latin-1')
    def pic(self): return struct.unpack_from('<I', self.m, self.sec('StringHeaders')[0] + 24)[0] != 1   # a header of the other form is the words of a static StringImpl: its reference count reads 1

    # ---- functions
    def function_at(self, offset):
        """offset counts from the start of the code part. None outside the functions."""
        if offset >= self.code['functionsEnd']: return None
        i = bisect.bisect_right(self.starts, offset) - 1
        if i < 0 or i >= len(self.fn): return None
        return i, self.starts[i], self.starts[i + 1]
    def region(self, offset):
        c = self.code
        for s in self.copies:
            if s <= offset < s + c['sharedCodeSize']: return 'shared code +0x%x' % (offset - s)
        if offset < c['functionsEnd']: return 'function'
        if c['webAssemblyCodeSize'] and c['webAssemblyCodeOffset'] <= offset < c['webAssemblyCodeOffset'] + c['webAssemblyCodeSize']: return 'WebAssembly'
        if c['regExpCodeOffset'] <= offset < c['constantsOffset']: return 'regular expression +0x%x' % (offset - c['regExpCodeOffset'])
        return 'other'
    def source_of(self, f):
        o, c = self.tab('functionSources'); n = self.tab('functionRecordNumbers')[1]; first = n - c
        return f if f < first else self.n24(o + 3 * (f - first))
    def name_of(self, f):
        m = self.m; s = self.source_of(f); n = self.tab('functionRecordNumbers')[1]; c = self.tab('functionSources')[1]
        if s >= n - c:
            o, k = self.tab('functionNameRuns'); runs = struct.unpack_from('<%dI' % (2 * k), m, o); i = bisect.bisect_right(runs[0::2], s) - 1; sid = runs[2 * i + 1]
        else:
            o, _ = self.tab('functionNameGroups'); bits, before = struct.unpack_from('<II', m, o + 8 * (s // 32))
            if not bits >> (s % 32) & 1: return ''
            sid = self.n24(self.tab('functionNames')[0] + 3 * (before + bin(bits & ((1 << (s % 32)) - 1)).count('1')))
        return self.text(sid) if sid else ''
    def positions(self):
        """for each image function: (source number = module + 1 | 0, line, column) of the function itself, and the place of its sites."""
        if self._positions is None:
            o, s = self.sec('Positions'); n = len(self.fn); at = o + 4 * ((n + 31) // 32); out = []; line = 0; source = 0
            for i in range(n):
                if not i % 32: line = 0; source = 0
                sf, at = self.varint(at); lw, at = self.varint(at)
                if lw & 1: d, at = self.varint(at); source += zigzag(d); line = 0
                line += zigzag(lw >> 1); col, at = self.varint(at); count = None
                if sf & 2: count, at = self.varint(at)
                out.append((source, line, col, at, at + (sf >> 2), sf & 1, count)); at += sf >> 2
            self._positions = out
        return self._positions
    def modules(self):
        if self._modules is None:
            m = self.m; o, c = self.tab('modules'); do, dc = self.tab('moduleDirectories'); size = (do - o) // c if c else 0; self.module_size = size; dirs = {}
            def directory(i):
                if i == 0xffffff or i >= dc: return ''
                if i not in dirs:
                    p = self.n24(do + 6 * i); nm = self.n24(do + 6 * i + 3); dirs[i] = directory(p) + self.text(nm)
                return dirs[i]
            self._modules = []
            for i in range(c):
                name = struct.unpack_from('<I', m, o + size * i)[0]; d = self.n24(o + size * i + 4)
                self._modules.append(directory(d) + self.text(name))
        return self._modules
    def describe(self, index):
        source, line, col = self.positions()[index][:3]; mods = self.modules()
        return self.name_of(self.fn[index]), (mods[source - 1] if 0 < source <= len(mods) else '?'), line, col

    # ---- sites: a return address inside a function -> the stack of inlined frames, each with its position
    def sites(self, index):
        """[(return offset, site number, inline frame)], {frame: (parent, call site, FunctionID)}, number of sites without code"""
        if not self.fflags[index] & 8: return [], {}, 0
        at = self.sec('SideTables')[0] + self.side[index]; fl = self.fflags[index]
        n, at = self.varint(at); at += n
        if n: _, at = self.varint(at)
        if fl & 4: _, at = self.varint(at); _, at = self.varint(at)
        if fl & 2: n, at = self.varint(at); at += n
        head, at = self.varint(at); count = head >> 3
        if head & 4:
            k, at = self.varint(at)
            for _ in range(k): _, at = self.varint(at); _, at = self.varint(at)
        without, at = self.varint(at); frames = {}
        if head & 2:
            nf, at = self.varint(at); size, at = self.varint(at); c = at; at += size
            for fr in range(1, nf + 1):
                w, c = self.varint(c); callee, c = self.varint(c); frames[fr] = (w >> 2, without - nf + fr, callee)
        at += (((count - 1) // 64) if count else 0) * 12
        out = []; off = 0; frame = 0; number = without
        for _ in range(count):
            w, at = self.varint(at); off += (w >> 1) * 4
            if w & 1: d, at = self.varint(at); frame = d >> 3
            number += 1; out.append((off, number, frame))
        return out, frames, without
    def site_positions(self, index):
        """{site number: (source, line, column)} for every site of the function"""
        source, line, col, at, end, follows, count = self.positions()[index]; start = (line, col, source); out = {0: (source, line, col)}
        sites, frames, without = self.sites(index); nf = len(frames); susp = without - nf; frame_of = {n: f for _, n, f in sites}
        if count: at += ((count - 1) // 512) * 2
        states = {}; site = 0
        while at < end:
            site += 1
            if not site % 512: states = {}
            f = 0
            if follows:
                if site <= susp: f = 0
                elif site <= without: f = frames[site - susp][0]
                else: f = frame_of.get(site, 0)
            l, c, s = states.get(f, start); w, at = self.varint(at)
            if w & 1: c += zigzag(w >> 1)
            else:
                l += zigzag(w >> 2)
                if w & 2: s, at = self.varint(at)
                c, at = self.varint(at)
            states[f] = (l, c, s); out[site] = (s, l, c)
        return out
    def stack_at(self, index, offset, is_return=True):
        """the frames at an offset inside the image function, innermost first: [(name, path, line, column)]. For a sampled pc that is no return address: the site in front of it (marked ~)."""
        key = index
        if key not in self._cache: self._cache[key] = (self.sites(index), self.site_positions(index))
        (sites, frames, without), pos = self._cache[key]; mods = self.modules()
        offs = [s[0] for s in sites]; i = bisect.bisect_left(offs, offset); exact = i < len(offs) and offs[i] == offset
        if exact:
            while i + 1 < len(offs) and offs[i + 1] == offset: i += 1
        else: i -= 1
        def where(p): return (mods[p[0] - 1] if 0 < p[0] <= len(mods) else '?'), p[1], p[2]
        if i < 0: return [(self.name_of(self.fn[index]),) + where(pos[0]) + ('entry',)]
        _, number, frame = sites[i]; out = []
        while True:
            fid = frames[frame][2] if frame else self.fn[index]
            out.append((self.name_of(fid),) + where(pos.get(number, pos[0])) + ('' if exact else '~',))
            if not frame: break
            parent, number, _ = frames[frame]; frame = parent
        return out
    # ---- regular expressions: ImageSection::RegExps (aot/runtime/AOTRegExpRecord.h: 32 bytes a record)
    def regexps(self):
        """[(pattern, raw flags, form 0 code | 1 atom | 2 no code | 3 no metadata, code for 8 bits, code for 16 bits, is a literal)]"""
        if self._regexps is None:
            o, s = self.sec('RegExps'); out = []
            for i in range(s // 32):
                pattern, atom, c8, c16, subs, minimum, details, flags, bits, specific = struct.unpack_from('<7IHBB', self.m, o + 32 * i)
                out.append((self.text(pattern), flags, bits & 3, c8, c16, bits >> 2 & 1))
            self._regexps = out
        return self._regexps
    def regexp_at(self, offset):
        """offset from the start of the code part: the pattern whose body begins last in front of it (a shared routine or table lies among the bodies: a large distance says so)"""
        if self._bodies is None:
            self._bodies = sorted((c, w, i) for i, r in enumerate(self.regexps()) if r[2] == 0 for c, w in ((r[3], 8), (r[4], 16)) if c not in (0, 0xffffffff))
        k = bisect.bisect_right([x[0] for x in self._bodies], offset) - 1
        if k < 0: return None
        c, w, i = self._bodies[k]; return self.regexps()[i], w, offset - c
    # ---- shared code
    def stubs(self):
        if self._stubs is None:
            import os
            # STUB_FAMILIES: a file with the names of the stub families in the order of aot/stubs/AOTStubFamilies.def, one a line. Without it a family is named by its number.
            fam = [l.strip() for l in open(os.environ['STUB_FAMILIES'])] if os.environ.get('STUB_FAMILIES') else []
            o, s = self.sec('StubAddresses'); out = []
            for i in range(s // 16):
                key, off, _ = struct.unpack_from('<QII', self.m, o + 16 * i)
                if off == 0xffffffff: continue
                f = (key >> 53) - 1; name = fam[f] if 0 <= f < len(fam) else 'family%d' % f
                form = key >> 47 & 63; cnt = key >> 41 & 63; cf = key >> 39 & 3; reg = key >> 33 & 63
                name += ('.f%d' % form if form else '') + ('.n%d' % cnt if cnt else '') + ['', '.Frameless', '.StubFrame', '.?'][cf] + ('(r%d)' % (reg - 1) if reg else '') + ('#%d' % (key & 0xffffffff) if key >> 32 & 1 else '')
                out.append((off, name))
            out.sort(); self._stubs = out
        return self._stubs
    def stub_at(self, offset):
        st = self.stubs(); i = bisect.bisect_right([x[0] for x in st], offset) - 1
        return '%s+0x%x' % (st[i][1], offset - st[i][0]) if i >= 0 else '?'

def main():
    im = Image(sys.argv[1]); what = sys.argv[2]
    if what == 'info':
        print('image at file offset 0x%x size %d code at +0x%x size %d executable %d address 0x%x flags 0x%x functions %d' % (im.base, im.size, im.code_offset, im.code_size, im.executable_size, im.address, im.flags, im.n_functions))
        print(im.code); print('shared code copies', [hex(x) for x in im.copies])
        for n in SECTIONS: print('  %-22s +0x%08x %10d' % (n, *im.sections[n]))
        for n in TABLES: print('    %-30s +0x%08x %9d' % (n, *im.tables[n]))
    elif what == 'functions':
        wanted = sys.argv[3] if len(sys.argv) > 3 else ''
        for i in range(len(im.fn)):
            name, path, line, column = im.describe(i)
            if wanted in name or wanted in path: print('0x%x\t%d\t%s\t%s:%d:%d' % (im.starts[i], im.starts[i + 1] - im.starts[i], name or '(anonymous)', path, line, column))
    elif what == 'at':
        for a in sys.argv[3:]:
            o = int(a, 16); f = im.function_at(o)
            if f:
                print(a, f[0], 'fn%d' % im.fn[f[0]], '+0x%x of 0x%x' % (o - f[1], f[2] - f[1]), *im.describe(f[0]))
                for fr in im.stack_at(f[0], o - f[1]): print('      ', *fr)
            else: print(a, im.region(o), im.stub_at(o) if im.region(o).startswith('shared') else '')
if __name__ == '__main__': main()
