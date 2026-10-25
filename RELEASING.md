# Releasing Autocode

The `release.yml` workflow runs when a `v<version>` tag is pushed. It checks the tag against `package.json` and `package-lock.json`, installs locked dependencies, runs the tests, verifies the npm tarball, publishes that tarball to npm, then creates a GitHub Release with the same tarball attached. A failed npm publish prevents the GitHub Release.

To test the build, package verification, and installed CLI on GitHub without publishing, run `gh workflow run release.yml --ref main`, then inspect the new run with `gh run list --workflow release.yml --limit 1` and `gh run watch <run-id>`.

## Before the first release

1. Confirm the npm package name `autocode-skill` is available and that the publishing account can claim it. This checkout has no npm login configured; no package has been published from it.
2. Set the repository's `NPM_TOKEN` Actions secret to a [granular npm token](https://docs.npmjs.com/about-access-tokens/) with read/write direct-publish access and bypass 2FA enabled. Its account must be allowed to create the public package. The first publish needs this token because npm trusted publishing can only be configured for an existing package.
3. Review `npm pack --dry-run --json`. The tarball is public even while the GitHub repository is private. The `files` allowlist keeps tests, workflows, journals, and recovered artifacts out of the package.

After the first publish, configure an [npm trusted publisher](https://docs.npmjs.com/trusted-publishers/) for GitHub owner `postfix`, repository `autocode`, workflow filename `release.yml`, with direct `npm publish` allowed. The workflow already grants `id-token: write`. Once a trusted publish succeeds, remove the `NPM_TOKEN` secret. npm does not generate provenance for packages published from private repositories.

## Make a release

Update both manifest and lockfile with `npm version <version> --no-git-tag-version`, commit that change, and push the commit to `main`. Run the local checks before tagging:

```bash
npm ci
npm test
npm pack --dry-run --json
```

Create and push an annotated tag for that exact version (for example, `v0.1.0`):

```bash
git tag -a v0.1.0 -m "Autocode v0.1.0"
git push origin v0.1.0
```

The workflow publishes to npm before creating the GitHub Release. The release command uses `--verify-tag`, so it cannot create a tag on a different commit. If npm publishes but GitHub Release creation fails, fix the GitHub step and create the release for the existing tag and tarball; do not republish the same npm version.
