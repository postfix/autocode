# Releasing Autocode

The `release.yml` workflow runs when a `v<version>` tag is pushed. It checks the tag against `package.json` and `package-lock.json`, installs locked dependencies, runs the tests, verifies the npm tarball, publishes that tarball to npm, then creates a GitHub Release with the same tarball attached. A failed npm publish prevents the GitHub Release.

To test the build, package verification, installed CLI, and npm publish preview on GitHub without publishing, run `gh workflow run release.yml --ref main`, then inspect the new run with `gh run list --workflow release.yml --limit 1` and `gh run watch <run-id>`.

## First release: bootstrap with MFA, then trust GitHub

npm [requires the package to exist](https://docs.npmjs.com/cli/v11/commands/npm-trust/) before you can configure Trusted Publishing. First, [enable 2FA](https://docs.npmjs.com/configuring-two-factor-authentication/) on the publishing npm account at **profile picture → Account → Two-Factor Authentication → Enable 2FA**; `npm profile get tfa --registry=https://registry.npmjs.org/` should then report it enabled. Publish a prerelease once from that interactive MFA account; this does not use a bypass-2FA token. The prerelease uses the `next` dist-tag so the later `v0.1.0` workflow can publish the first `latest` version.

From the checkout at the release commit, prepare an isolated prerelease tarball:

```bash
BOOTSTRAP_DIR="$(mktemp -d)"
git archive HEAD | tar -x -C "$BOOTSTRAP_DIR"
(
  cd "$BOOTSTRAP_DIR"
  npm version 0.1.0-rc.0 --no-git-tag-version
  npm pack --pack-destination "$BOOTSTRAP_DIR"
)
```

Review the tarball contents, then sign in and publish it from your own terminal. npm will require your account's interactive MFA:

```bash
npm login --registry=https://registry.npmjs.org/
npm publish "$BOOTSTRAP_DIR/autocode-skill-0.1.0-rc.0.tgz" --tag next --access public --registry=https://registry.npmjs.org/
npm view autocode-skill@0.1.0-rc.0 version --registry=https://registry.npmjs.org/
```

After the prerelease exists, add a [Trusted Publisher](https://docs.npmjs.com/trusted-publishers/) from the same MFA-authenticated npm CLI session:

```bash
npm trust github autocode-skill --file release.yml --repo postfix/autocode --allow-publish --registry=https://registry.npmjs.org/
npm trust list autocode-skill --registry=https://registry.npmjs.org/
```

This requires npm CLI 11.15.0 or newer and may prompt for MFA. In npm's website, the equivalent settings are GitHub owner `postfix`, repository `autocode`, workflow filename `release.yml`, and **Allow npm publish** enabled. Set no environment name unless the workflow also uses that exact GitHub environment. The workflow already grants `id-token: write` on a GitHub-hosted runner. Complete the first trusted publish within two days of configuring the publisher. After it succeeds, set npm publishing access to **Require two-factor authentication and disallow tokens**.

The tarball is public even while the GitHub repository is private. The `files` allowlist keeps tests, workflows, journals, and recovered artifacts out of the package. npm does not generate provenance for packages published from private repositories.

## Make a release

Update both manifest and lockfile with `npm version <version> --no-git-tag-version`, commit that change, and push the commit to `main`. Run the local checks before tagging:

```bash
npm ci
npm test
npm pack --dry-run --json
```

Create and push an annotated tag for that exact version (for example, `v0.1.1`):

```bash
git tag -a v0.1.1 -m "Autocode v0.1.1"
git push origin v0.1.1
```

The workflow publishes to npm before creating the GitHub Release. The release command uses `--verify-tag`, so it cannot create a tag on a different commit. If npm publishes but GitHub Release creation fails, fix the GitHub step and create the release for the existing tag and tarball; do not republish the same npm version.
