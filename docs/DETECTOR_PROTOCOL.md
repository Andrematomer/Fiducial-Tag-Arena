# Detector protocol (protocol 1)

The desktop app talks to every external detector the way a chess GUI talks to Stockfish: it starts
the detector as a **separate program** and exchanges messages over its **stdin/stdout**. The app never
links, bundles or modifies detector code, so each detector keeps its own licence.

## Installing a detector

```
detectors/
  my-detector/
    detector.json
    my-detector.exe          (plus whatever DLLs it needs)
```

`detector.json`:

```json
{
  "key": "cctag",
  "name": "CCTag",
  "family": "Circular · rings",
  "license": "MPL-2.0",
  "note": "free text shown in the UI",
  "exe": "arena-cctag.exe",
  "args": [],
  "idCount": 32
}
```

The app looks in `ARENA_DETECTORS` (path list), `<app folder>/detectors`, then parent folders of the
app (development checkouts). The first detector found for a `key` wins.

## Messages

One JSON object per line (terminated by `\n`). If the object has `"payload": N`, exactly `N` raw bytes
follow immediately after the newline. Replies use the same framing. Every reply has `"ok": true|false`;
on failure add `"error": "..."`. Images are 8-bit grayscale, row-major, top-left origin.

| Request | Reply |
|---|---|
| `{"cmd":"hello","protocol":1}` | `{"ok":true,"name":"...","idCount":N,"protocol":1}` |
| `{"cmd":"generate","id":7,"size":512}` | `{"ok":true,"outerFrac":0.8,"payload":size*size}` + gray bytes |
| `{"cmd":"detect","w":128,"h":128,"payload":16384}` + gray bytes | `{"ok":true,"ms":0.31,"dets":[{"id":7,"corners":[[x,y],[x,y],[x,y],[x,y]]}]}` |
| `{"cmd":"quit"}` | (process exits) |

* `generate` draws marker `id` filling the whole image on a white background. `outerFrac` is the side of the
  marker's outer black square (or outer ring diameter) as a fraction of the image side. The app uses it to
  place every tag at the same size and pose.
* `detect`'s `ms` must be measured **inside the program around the detector call only** (not pipes, not
  image decoding). The app uses it instead of its own clock.
* `corners` are in image pixels, in order top-left, top-right, bottom-right, bottom-left of the tag's outer
  square (for circular tags, any four points of the outer ring's bounding square are fine). A detection is
  scored correct when `id` matches and the centre is within 25% of the tag side.
* The detector must keep running between requests, so JIT/warm-up costs are paid once.

## Reference implementation and tests

`detectors-src/selftest` is a toy detector that implements the protocol. It exists only to test the plumbing
and is not a real marker system.

```
cargo build --release --manifest-path detectors-src/selftest/Cargo.toml
ARENA_TEST_EXE=$PWD/detectors-src/selftest/target/release/arena-selftest \
  cargo test --manifest-path crates/arena-core/Cargo.toml
python test/e2e.py detectors-src/selftest/target/release/arena-selftest
```
