### Changed
- Renamed the package from `tidyrepo` to `vibetidy`. npm rejected `tidyrepo`
  as too similar to the existing `tidy-repo` package — its similarity check
  strips punctuation, so the two collide. Environment variables are now
  `VIBETIDY_*` and the pre-commit hook markers changed accordingly.
