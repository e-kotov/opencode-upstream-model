# Changelog

## v0.2.0

First OpenCode 2 release of the upstream-model status plugin.

### Added

- Shows the model a configured gateway says actually answered, using response
  headers and the OpenCode 2 prompt-footer status row.
- Per-session provider identity storage and configurable provider observation.

### Compatibility

- The `0.2.x` line requires OpenCode 2. OpenCode 1 files remain in the source
  tree for reference and do not load in this line.

### Verified

- Tests and plugin loading against OpenCode 2.1.4 pass in GitHub Actions.
