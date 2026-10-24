# Commit conventions

Commits use the Conventional Commits form `type(scope): subject`. The scope is
optional, the subject is required, and the complete header is limited to 100
characters.

Running `npm install` at the repository root installs Husky. Every commit then
passes its message file to commitlint. Run `npm run test:commitlint` to verify
both accepted and rejected examples without creating a commit.
