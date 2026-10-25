// `node scripts/release-notes.ts <tag>`: prints the GitHub release notes of a release tag (`v1.3.0`,
// or the bare version): its CHANGELOG.md section, written by `pnpm release:version`, for
// release.yml's github-release job. Fails when the changelog has no section for the version.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dirname, '..')

/**
 * The body of `version`'s section in `changelog` (from its `## x.y.z (date)` heading to the next
 * `## ` heading, the heading itself left out, since the release is titled by its tag), followed by
 * an install line; `undefined` when there is no such section.
 */
export function releaseNotes(changelog: string, version: string, name: string): string | undefined {
  const lines = changelog.split('\n')
  const start = lines.findIndex((line) => line.startsWith(`## ${version} (`))
  if (start === -1) return undefined
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  const body = lines
    .slice(start + 1, next === -1 ? undefined : next)
    .join('\n')
    .trim()
  const install = `Published to npm as \`${name}@${version}\`: \`npm install ${name}@${version}\`.`
  return `${body === '' ? 'No notable changes.' : body}\n\n${install}\n`
}

if (import.meta.main) {
  const tag = process.argv[2]
  if (!tag) {
    console.error('Usage: node scripts/release-notes.ts <tag>   (v1.3.0)')
    process.exit(2)
  }
  const version = tag.replace(/^v/, '')
  const { name } = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { name: string }
  const path = join(REPO, 'CHANGELOG.md')
  const notes = existsSync(path)
    ? releaseNotes(readFileSync(path, 'utf8'), version, name)
    : undefined
  if (notes === undefined) {
    console.error(`${path} has no "## ${version} (…)" section.`)
    process.exit(1)
  }
  process.stdout.write(notes)
}
