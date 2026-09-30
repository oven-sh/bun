// The Go half of update-reference.ts, which builds it beside the declarations that it cuts out of a clone of typescript-go.
package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"runtime"
	"slices"
	"unicode"
)

// The type and the value of the reference's diagnostics that its scanner names; nothing here builds a message.
type Message struct{}

var Merge_conflict_marker_encountered *Message

// One entry of fixtures/directives-inputs.json; the bytes of the file are base64.
type directiveInput struct {
	Name     string `json:"name"`
	FileName string `json:"fileName"`
	Bytes    string `json:"bytes"`
	Implicit bool   `json:"allowImplicitFirstFile"`
	FailOn   string `json:"failOn"`
}

type directiveUnit struct {
	Name    string            `json:"name"`
	Content string            `json:"content"`
	Opts    map[string]string `json:"fileOptions"`
}

// One entry of fixtures/directives-expected.json: what the reference makes of the input.
type directiveOutput struct {
	Name             string            `json:"name"`
	Decoded          string            `json:"decoded"`
	Lines            []string          `json:"lines"`
	Settings         map[string]string `json:"settings"`
	Panic            string            `json:"panic"`
	Units            []directiveUnit   `json:"units"`
	ConfigUnit       *directiveUnit    `json:"configUnit"`
	Symlinks         map[string]string `json:"symlinks"`
	CurrentDirectory string            `json:"currentDirectory"`
	GlobalOptions    map[string]string `json:"globalOptions"`
	SkipTrivia       int               `json:"skipTrivia"`
	Error            string            `json:"error"`
	DecodedByteLen   int               `json:"decodedByteLen"`
}

// The result is named: where the reference panics, the entry keeps what was known before and the text of the panic.
func directive(in directiveInput) (out directiveOutput) {
	raw, err := base64.StdEncoding.DecodeString(in.Bytes)
	if err != nil {
		panic(err)
	}
	content := ""
	if len(raw) != 0 {
		content, _ = decodeBytes(string(raw))
	}
	out = directiveOutput{
		Name:           in.Name,
		Decoded:        content,
		Lines:          lineDelimiter.Split(content, -1),
		Settings:       extractCompilerSettings(content),
		Units:          []directiveUnit{},
		Symlinks:       map[string]string{},
		GlobalOptions:  map[string]string{},
		SkipTrivia:     SkipTrivia(content, 0),
		DecodedByteLen: len(content),
	}
	defer func() {
		if r := recover(); r != nil {
			out.Panic = fmt.Sprint(r)
		}
	}()
	parseFile := func(filename string, content string, fileOptions map[string]string) (*directiveUnit, error) {
		if in.FailOn != "" && filename == in.FailOn {
			return &directiveUnit{Name: "FAILED:" + filename, Content: content, Opts: fileOptions}, errors.New("cannot parse " + filename)
		}
		return &directiveUnit{Name: filename, Content: content, Opts: fileOptions}, nil
	}
	units, symlinks, currentDirectory, globalOptions, e := ParseTestFilesAndSymlinksWithOptions(content, in.FileName, parseFile, ParseTestFilesOptions{AllowImplicitFirstFile: in.Implicit})
	if e != nil {
		out.Error = e.Error()
	}
	out.Symlinks = symlinks
	out.CurrentDirectory = currentDirectory
	out.GlobalOptions = globalOptions
	// makeUnitsFromTest takes the first unit that is named as a configuration file out of the units.
	if !in.Implicit {
		for i, unit := range units {
			if GetConfigNameFromFileName(unit.Name) != "" {
				out.ConfigUnit = unit
				units = slices.Delete(units, i, i+1)
				break
			}
		}
	}
	for _, unit := range units {
		out.Units = append(out.Units, *unit)
	}
	return out
}

func directives(path string) {
	raw, err := os.ReadFile(path)
	if err != nil {
		panic(err)
	}
	var inputs []directiveInput
	if err := json.Unmarshal(raw, &inputs); err != nil {
		panic(err)
	}
	outputs := []directiveOutput{}
	for _, in := range inputs {
		outputs = append(outputs, directive(in))
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", " ")
	if err := enc.Encode(outputs); err != nil {
		panic(err)
	}
}

// Digests of Go's case and space tables and of the reference's white space classes, over every code point.
func tables() {
	lower, fold, space, white := sha256.New(), sha256.New(), sha256.New(), sha256.New()
	for r := rune(0); r <= unicode.MaxRune; r++ {
		if l := unicode.ToLower(r); l != r {
			fmt.Fprintf(lower, "%x %x\n", r, l)
		}
		key := r
		for n := unicode.SimpleFold(r); n != r; n = unicode.SimpleFold(n) {
			key = min(key, n)
		}
		if key != r {
			fmt.Fprintf(fold, "%x %x\n", r, key)
		}
		if unicode.IsSpace(r) {
			fmt.Fprintf(space, "%x\n", r)
		}
		if IsWhiteSpaceLike(r) {
			fmt.Fprintf(white, "%x %v %v\n", r, IsWhiteSpaceSingleLine(r), IsLineBreak(r))
		}
	}
	sum := func(h interface{ Sum([]byte) []byte }) string { return hex.EncodeToString(h.Sum(nil)) }
	answer := map[string]string{
		"go":      runtime.Version(),
		"unicode": unicode.Version,
		"lower":   sum(lower),
		"foldKey": sum(fold),
		"space":   sum(space),
		"white":   sum(white),
	}
	if err := json.NewEncoder(os.Stdout).Encode(answer); err != nil {
		panic(err)
	}
}

func main() {
	switch {
	case len(os.Args) == 2 && os.Args[1] == "tables":
		tables()
	case len(os.Args) == 3 && os.Args[1] == "directives":
		directives(os.Args[2])
	default:
		fmt.Fprintln(os.Stderr, "usage: reference tables | reference directives <fixtures/directives-inputs.json>")
		os.Exit(2)
	}
}
