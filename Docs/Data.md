# Data: bytes, files, gzip and JSON

`Source/Core/Data` holds format code a game needs for saves, settings, caches
or anything else it keeps on disk. It is all Duck, in `quaxel_core`, so it
works the same in the headless and Windows builds and links no native
library. Formats work on byte arrays (`uint8 []`), not Duck text: gzip is
binary, and JSON is UTF-8.

| File | What it gives |
| --- | --- |
| `Bytes.dk` | `QuaxelBytes`: text to and from UTF-8 bytes. `QuaxelFiles`: whole files and folders. |
| `Gzip.dk` | `QuaxelGzip`: gzip and raw deflate, both ways. `QuaxelCrc32`. |
| `Json.dk` | `QuaxelJsonWriter` and the `QuaxelJson` parser. |

## Bytes and files

```duck
uint8 [] bytes
QuaxelBytes.AppendText(bytes, "café")      // 5 bytes of UTF-8
string text = QuaxelBytes.ToText(bytes)          // broken UTF-8 becomes U+FFFD
QuaxelBytes.Equal(a, b)

QuaxelFiles.MakeFolder("Saves")                  // true when it is there and writable
QuaxelFiles.WriteBytes("Saves/a.bin", bytes)     // replaces the file
QuaxelFiles.ReadBytes("Saves/a.bin", bytes)      // appends the whole file
QuaxelFiles.Exists("Saves/a.bin")
QuaxelFiles.Remove("Saves/a.bin")
```

Paths are relative to the working directory, like Duck's `file`. `MakeFolder`
makes one level; its parent must exist. Writing is not atomic: to keep the
last good copy through a crash, write a second file and alternate between
them, as Hellfeather's saves do.

## gzip

```duck
uint8 [] packed
QuaxelGzip.Compress(plain, packed)               // appends a whole .gz file
uint8 [] unpacked
if !QuaxelGzip.Decompress(packed, unpacked) { ... }
```

- **Compress** writes one deflate block of LZ77 matches (32 KB window, a hash
  chain of `MaxChain` = 64) with the fixed Huffman codes. It is quick and
  roughly halves text such as JSON; zlib at its best does about a third
  better. The header carries no name or time.
- **Decompress** reads every block kind (stored, fixed and dynamic codes) and
  skips the optional header fields (extra data, name, comment, header CRC), so
  anything packed by `gzip`, 7-Zip or Python's `gzip` reads back. It checks
  the CRC-32 and the length in the trailer, and gives false for a file that
  is not gzip, is cut short or was changed.
- `QuaxelGzip.Inflate(data, start, out)` and `QuaxelGzip.Deflate(input, bits)`
  work on raw deflate streams with no gzip wrapper, as zip and PNG use.
- `QuaxelCrc32.Of(bytes)` is the CRC-32 of gzip, zip and PNG.

Everything happens in memory, so one call handles a whole file. That suits
files of up to a few megabytes; there is no streaming interface.

## JSON

### Writing

```duck
QuaxelJsonWriter out
out.BeginObject("")                  // the root has no key
out.Int("level", 7)
out.Bool("alive", true)
out.String("hero", "Wren")
out.Text("item", item.Name)          // a name (UTF-8), such as an enum member's
out.Number("speed", 2.5, 2)          // 2.50: a decimal with fixed digits
out.Pair("cell", 4, 5)               // [4, 5] on one line
out.Null("held")
out.BeginArray("bag")
out.Int("", 3)                       // array items take "" for a key
out.EndArray()
out.EndObject()
// out.Bytes holds the document
```

Output is indented two spaces with a line per member; set `Pretty = false`
before writing for a single line. Strings are escaped as JSON requires.
Calls must nest like the document: the writer does not check.

### Reading

```duck
QuaxelJson json
if json.Parse(bytes) {                         // or json.ParseText(text)
    int progress = json.Find(0, "progress")    // node 0 is the root
    int level = json.Int(progress, "level", 1) // 1 when missing or not a number
    for item : json.First(json.Find(0, "bag")); item >= 0; item = json.Next(item) {
        string label = json.AsString(item)
    }
}
```

The document becomes a flat list of nodes (`json.Nodes`), each linked to its
first child and next sibling. Every lookup takes a node and returns a node, or
-1 when it is missing, and every read takes a fallback, so lookups into a
document that lacks a part simply give the fallbacks:

| Call | Gives |
| --- | --- |
| `Find(object, key)` | the member, or -1 |
| `First(node)`, `Next(node)`, `Count(node)` | walking an array's items or an object's members |
| `KindOf(node)`, `KeyOf(node)` | `QuaxelJsonKind` (Null for -1), and a member's key |
| `IsObject(node)`, `IsArray(node)` | |
| `AsInt`, `AsNumber`, `AsBool` | the value, or the fallback for -1 or another kind |
| `AsText` (`name`), `AsString` (`string`) | the text, or empty |
| `Int`, `NumberOf`, `Bool`, `Text` | `Find` and `As…` in one call |

`Parse` gives false for malformed JSON, text after the document, or nesting
deeper than 64. It decodes `\uXXXX` escapes, surrogate pairs and UTF-8.
Numbers are doubles; `AsInt` rounds them and falls back outside `int`.

## Tolerant formats

A file read back by a later version of the game is easier to keep working
when every value is found by key and has a fallback, as `QuaxelJson` makes
natural. A field the file lacks then keeps its default, and one the game no
longer knows is skipped, so most changes need no version bump. Save enum
members by `Name` rather than position, and look them up again with a loop
over the enum, since a member added in the middle would shift every position.
Hellfeather's `Source/Saves.dk` is a full example: gzip-compressed JSON in two
alternating snapshots with a generation number.
