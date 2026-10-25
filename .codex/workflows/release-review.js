export const meta = { name: 'release-review', description: 'Review npm package and GitHub release seams' };
phase('Review release design');
const reviews = await parallel([
  () => agent('Inspect package.json, scripts/autocode.mjs, SKILL.md, INSTALL.md, and tests in this repository. Recommend the smallest npm package metadata, bin mapping, and file list that preserve skill installation for Codex and Claude. Identify concrete packaging checks. Return concise findings; make no edits.', { label: 'Package review', effort: 'low' }),
  () => agent('Inspect this repository for an existing GitHub Actions setup and release instructions. Recommend the smallest tag-driven GitHub Release plus npm publication workflow. Identify exact version and tarball checks, required permissions and account setup, and risks of its currently private visibility. Return concise findings; make no edits.', { label: 'Release review', effort: 'low' }),
]);
return reviews;
