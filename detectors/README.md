# detectors/

Drop external detector programs here, one folder per detector, each with a `detector.json`.
The app starts them as separate processes (like a chess GUI talking to Stockfish) and never
bundles or links their code. See `docs/DETECTOR_PROTOCOL.md`.

Nothing in this folder except this file is committed to git.
