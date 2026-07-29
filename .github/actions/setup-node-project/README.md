# Setup Node project action

This composite action centralizes Node setup and caching for repository
workflows. The npm download cache is keyed by the selected lockfile, while
reusable tool output is isolated by operating system, Node version, an
explicit cache schema version, and the lockfile hash.

Increment `cache-version` after changing the cached directory layout.
