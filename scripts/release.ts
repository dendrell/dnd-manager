// `pnpm release:version <x.y.z>`: sets package.json's version, prepends the release's section to
// CHANGELOG.md from the Conventional Commits since the last release, commits
// `chore(release): vX.Y.Z` and tags it vX.Y.Z. It pushes nothing: pushing the tag runs
// .github/workflows/release.yml, which publishes to npm and creates the GitHub release.
//
// The last release is the last `v*` tag; before the first tag, the last commit that changed
// package.json's version. Before writing anything it runs the checks the release workflow runs
// (typecheck, unit tests, build, publint), so a pushed tag does not fail there; `--skip-checks`
// skips them. `--dry-run` prints the plan and writes nothing.
//
//   node scripts/release.ts <x.y.z> [--dry-run] [--since <rev>] [--skip-checks]

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const REPO = fileURLToPath(new URL('..', import.meta.url))
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

/** -1, 0 or 1 as semver `a` is lower than, equal to or higher than `b`. */
export function compareVersions(a: string, b: string): number {
  const pa = VERSION.exec(a)
  const pb = VERSION.exec(b)
  if (pa === null || pb === null) throw new Error(`not a version: ${pa === null ? a : b}`)
  for (let i = 1; i <= 3; i++) {
    const diff = Number(pa[i]) - Number(pb[i])
    if (diff !== 0) return Math.sign(diff)
  }
  if (pa[4] === pb[4]) return 0
  if (pa[4] === undefined) return 1
  if (pb[4] === undefined) return -1
  return pa[4] < pb[4] ? -1 : 1
}

export type Commit = {
  hash: string
  type: string
  scope?: string
  subject: string
  breaking: boolean
}

/** A Conventional Commit (`type(scope)!: subject`), or undefined for any other message. */
export function parseCommit(hash: string, message: string): Commit | undefined {
  const [header = '', ...body] = message.split('\n')
  const match = /^(\w+)(?:\(([^)]+)\))?(!)?: (.+)$/.exec(header.trim())
  if (match === null) return undefined
  const breaking = match[3] === '!' || body.some((line) => /^BREAKING[ -]CHANGE:/.test(line))
  return { hash, type: match[1]!, scope: match[2], subject: match[4]!, breaking }
}

/**
 * The hashes that `Breaks: <hash>` trailers name: a later commit marks an earlier, already pushed
 * one as breaking when that one lacked the `!`, without rewriting history.
 */
export function brokenHashes(messages: string[]): string[] {
  return messages.flatMap((message) =>
    [...message.matchAll(/^Breaks: ([0-9a-f]{7,40})$/gm)].map((match) => match[1]!),
  )
}

const SECTIONS: [string, (commit: Commit) => boolean][] = [
  ['Breaking changes', (c) => c.breaking],
  ['Features', (c) => !c.breaking && c.type === 'feat'],
  ['Fixes', (c) => !c.breaking && c.type === 'fix'],
  ['Performance', (c) => !c.breaking && c.type === 'perf'],
]

/** The CHANGELOG.md section of a release: breaking changes, features, fixes and performance. */
export function renderChangelog(version: string, date: string, commits: Commit[]): string {
  const lines = [`## ${version} (${date})`, '']
  let listed = 0
  for (const [title, belongs] of SECTIONS) {
    const entries = commits.filter(belongs)
    if (entries.length === 0) continue
    lines.push(`### ${title}`, '')
    for (const c of entries) {
      lines.push(`- ${c.scope === undefined ? '' : `**${c.scope}:** `}${c.subject} (${c.hash})`)
    }
    lines.push('')
    listed += entries.length
  }
  if (listed === 0) lines.push('No user-facing changes.', '')
  return lines.join('\n')
}

const HEADER =
  '# Changelog\n\nThe releases of dnd-manager, newest first. Versions follow semver.\n\n'

/** A CHANGELOG.md with the header and `section` above the previous releases (its `## ` sections). */
export function prependChangelog(current: string | undefined, section: string): string {
  const start = current?.search(/^## /m) ?? -1
  const previous =
    current === undefined || start === -1
      ? current?.startsWith('# ')
        ? ''
        : (current ?? '')
      : current.slice(start)
  return `${HEADER}${section}${previous.length > 0 ? `\n${previous}` : ''}`
}

/** `text` (a package.json) with its top-level version set, keeping the file's formatting. */
export function setPackageVersion(text: string, version: string): string {
  const next = text.replace(/^( {2}"version": )"[^"]*"/m, `$1"${version}"`)
  if (next === text && !text.includes(`"version": "${version}"`)) {
    throw new Error('package.json has no top-level version')
  }
  return next
}

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim()
}

/** The last `v*` tag reachable from HEAD, if any. */
function lastTag(repo: string): string | undefined {
  try {
    return git(repo, ['describe', '--tags', '--abbrev=0', '--match', 'v*'])
  } catch {
    return undefined
  }
}

/**
 * Where the changelog starts after: the last `v*` tag or, before the first one, the last commit
 * that changed package.json's version (the releases published by hand); none: every commit.
 */
export function lastRelease(repo: string): string | undefined {
  const tag = lastTag(repo)
  if (tag !== undefined) return tag
  const bump = git(repo, ['log', '-1', '--format=%h', '-G', '^  "version": ', '--', 'package.json'])
  return bump === '' ? undefined : bump
}

/** The Conventional Commits after `since` (default: the last release; none: every commit). */
export function commitsSince(repo: string, since = lastRelease(repo)): Commit[] {
  const range = since === undefined ? 'HEAD' : `${since}..HEAD`
  const log = git(repo, ['log', '--no-merges', '--format=%h%x1f%B%x1e', range])
  const entries = log
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hash = '', message = ''] = entry.split('\x1f')
      return { hash, message: message.trim() }
    })
  const broken = brokenHashes(entries.map((entry) => entry.message))
  return entries
    .map(({ hash, message }) => parseCommit(hash, message))
    .filter((commit): commit is Commit => commit !== undefined)
    .map((commit) =>
      broken.some((other) => other.startsWith(commit.hash) || commit.hash.startsWith(other))
        ? { ...commit, breaking: true }
        : commit,
    )
}

export type ReleaseOptions = {
  dryRun?: boolean
  /** The revision the changelog starts after (default: the last release). */
  since?: string
  /** Skip the local checks (typecheck, unit tests, build, publint). */
  skipChecks?: boolean
  /** The release date for the changelog (default: today, UTC). */
  date?: string
  log?: (line: string) => void
}

/** A planned release: the tag, the files to write (path → content) and the changelog section. */
export type ReleasePlan = {
  current: string
  tag: string
  files: Map<string, string>
  changelog: string
}

/** Plans the release of `version` in `repo`: package.json and CHANGELOG.md. */
export function planRelease(
  repo: string,
  version: string,
  options: ReleaseOptions = {},
): ReleasePlan {
  if (!VERSION.test(version)) throw new Error(`not a version: ${version} (expected x.y.z)`)
  const manifestPath = join(repo, 'package.json')
  const manifestText = readFileSync(manifestPath, 'utf8')
  const current = (JSON.parse(manifestText) as { version: string }).version
  if (compareVersions(version, current) <= 0) {
    throw new Error(`${version} is not above the current version ${current}`)
  }
  const date = options.date ?? new Date().toISOString().slice(0, 10)
  const changelog = renderChangelog(version, date, commitsSince(repo, options.since))
  const changelogPath = join(repo, 'CHANGELOG.md')
  const previous = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : undefined
  const files = new Map([
    [manifestPath, setPackageVersion(manifestText, version)],
    [changelogPath, prependChangelog(previous, changelog)],
  ])
  return { current, tag: `v${version}`, files, changelog }
}

/** The checks the release workflow runs before publishing. */
const CHECKS: string[][] = [
  ['pnpm', 'typecheck'],
  ['pnpm', 'test:unit', '--run'],
  ['pnpm', 'build'],
  ['pnpm', 'exec', 'publint'],
]

/**
 * Releases `version`: on a clean working tree, runs the checks, writes the planned files, commits
 * them and tags the commit. With `dryRun`, only reports the plan.
 */
export function release(repo: string, version: string, options: ReleaseOptions = {}): void {
  const log = options.log ?? console.log
  const tag = `v${version}`
  if (!options.dryRun) {
    const status = git(repo, ['status', '--porcelain'])
    if (status !== '') {
      throw new Error(`the working tree has changes; commit or stash them first:\n${status}`)
    }
  }
  if (git(repo, ['tag', '--list', tag]) !== '') throw new Error(`the tag ${tag} already exists`)
  const plan = planRelease(repo, version, options)
  log(`${options.dryRun ? 'dry run: ' : ''}${plan.current} -> ${version}`)
  log('')
  log(plan.changelog)
  if (options.dryRun) return
  if (!options.skipChecks) {
    for (const [command, ...args] of CHECKS) {
      log(`$ ${command} ${args.join(' ')}`)
      execFileSync(command!, args, { cwd: repo, stdio: 'inherit' })
    }
  }
  for (const [path, content] of plan.files) writeFileSync(path, content)
  const paths = ['package.json', 'CHANGELOG.md']
  git(repo, ['add', '--', ...paths])
  git(repo, ['commit', '-q', '-m', `chore(release): ${tag}`, '--', ...paths])
  git(repo, ['tag', '-a', tag, '-m', tag])
  log(`Committed and tagged ${tag}. Push both to release: git push origin HEAD ${tag}`)
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'dry-run': { type: 'boolean', default: false },
      since: { type: 'string' },
      'skip-checks': { type: 'boolean', default: false },
    },
  })
  if (positionals.length !== 1) {
    console.error('Usage: pnpm release:version <x.y.z> [--dry-run] [--since <rev>] [--skip-checks]')
    process.exit(2)
  }
  try {
    release(REPO, positionals[0]!, {
      dryRun: values['dry-run'],
      since: values.since,
      skipChecks: values['skip-checks'],
    })
  } catch (error) {
    console.error(`release:version: ${(error as Error).message}`)
    process.exit(1)
  }
}
