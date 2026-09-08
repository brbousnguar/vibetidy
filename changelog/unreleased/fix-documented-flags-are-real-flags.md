### Fixed
- `--skip-changelog` (was `--no-changelog`, which was documented but never
  registered in the parser and exited 2 when used).
- `npm test` now runs on Node 20. The script used a `node --test` glob pattern,
  which requires Node 21+, so the suite never ran on the floor the package
  advertises.
- The hook-is-executable assertion no longer fails on Windows, where file mode
  bits carry no such meaning.
