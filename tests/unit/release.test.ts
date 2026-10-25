// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { releaseNotes } from '../../scripts/release-notes'
import {
  compareVersions,
  lastRelease,
  parseCommit,
  planRelease,
  prependChangelog,
  release,
  renderChangelog,
  setPackageVersion,
} from '../../scripts/release'

describe('release helpers', () => {
  test('compares semver versions, pre-releases below their release', () => {
    expect(compareVersions('1.3.0', '1.2.9')).toBe(1)
    expect(compareVersions('1.3.0-beta.1', '1.3.0')).toBe(-1)
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0)
    expect(() => compareVersions('1.3', '1.2.0')).toThrow('not a version')
  })

  test('parses Conventional Commits and their breaking marks', () => {
    expect(parseCommit('abc1234', 'feat(keyboard): pick up with Space')).toEqual({
      hash: 'abc1234',
      type: 'feat',
      scope: 'keyboard',
      subject: 'pick up with Space',
      breaking: false,
    })
    expect(parseCommit('abc1234', 'fix!: drop the old API')?.breaking).toBe(true)
    expect(parseCommit('abc1234', 'fix: x\n\nBREAKING CHANGE: y')?.breaking).toBe(true)
    expect(parseCommit('abc1234', 'Update README')).toBeUndefined()
  })

  test('renders a changelog section by kind, leaving other commits out', () => {
    const commits = [
      { hash: 'a1', type: 'feat', subject: 'add canDrop', breaking: false },
      { hash: 'b2', type: 'fix', scope: 'touch', subject: 'keep drags alive', breaking: false },
      { hash: 'c3', type: 'docs', subject: 'reword', breaking: false },
      { hash: 'd4', type: 'feat', subject: 'rename a callback', breaking: true },
    ]
    expect(renderChangelog('1.3.0', '2026-10-25', commits)).toBe(
      [
        '## 1.3.0 (2026-10-25)',
        '',
        '### Breaking changes',
        '',
        '- rename a callback (d4)',
        '',
        '### Features',
        '',
        '- add canDrop (a1)',
        '',
        '### Fixes',
        '',
        '- **touch:** keep drags alive (b2)',
        '',
      ].join('\n'),
    )
    expect(renderChangelog('1.3.1', '2026-10-26', [commits[2]!])).toContain(
      'No user-facing changes.',
    )
  })

  test('prepends a section above the previous releases', () => {
    const first = prependChangelog(undefined, '## 1.3.0 (d)\n\n- a\n')
    expect(first).toMatch(/^# Changelog\n/)
    const second = prependChangelog(first, '## 1.4.0 (d)\n\n- b\n')
    expect(second.indexOf('## 1.4.0')).toBeLessThan(second.indexOf('## 1.3.0'))
    expect(second.match(/# Changelog/g)).toHaveLength(1)
  })

  test("sets package.json's version, keeping its formatting", () => {
    const text = '{\n  "name": "x",\n  "version": "1.2.0",\n  "deps": { "version": "9" }\n}\n'
    expect(setPackageVersion(text, '1.3.0')).toBe(text.replace('1.2.0', '1.3.0'))
    expect(() => setPackageVersion('{}', '1.3.0')).toThrow('no top-level version')
  })

  test('takes the release notes from the version section', () => {
    const changelog = '# Changelog\n\n## 1.4.0 (d)\n\n- b\n\n## 1.3.0 (d)\n\n- a\n'
    expect(releaseNotes(changelog, '1.3.0', 'dnd-manager')).toBe(
      '- a\n\nPublished to npm as `dnd-manager@1.3.0`: `npm install dnd-manager@1.3.0`.\n',
    )
    expect(releaseNotes(changelog, '1.5.0', 'dnd-manager')).toBeUndefined()
  })
})

describe('planRelease and release', () => {
  let repo = ''
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  const commit = (message: string, file = 'src.txt'): void => {
    writeFileSync(join(repo, file), `${message}\n`)
    git('add', '.')
    git('commit', '-q', '-m', message)
  }

  afterEach(() => {
    if (repo) rmSync(repo, { recursive: true, force: true })
  })

  function setupRepo(): void {
    repo = mkdtempSync(join(tmpdir(), 'dnd-release-'))
    git('init', '-q')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    git('config', 'commit.gpgsign', 'false')
    git('config', 'tag.gpgsign', 'false')
    commit('feat: first feature')
    writeFileSync(
      join(repo, 'package.json'),
      '{\n  "name": "dnd-manager",\n  "version": "1.2.0"\n}\n',
    )
    commit('feat: released by hand in 1.2.0')
    commit('fix: after 1.2.0')
    commit('docs: not in the changelog')
  }

  test('starts after the last version bump before the first tag, then after the last tag', () => {
    setupRepo()
    const bump = git('log', '-1', '--format=%h', '--', 'package.json')
    expect(lastRelease(repo)).toBe(bump)

    const plan = planRelease(repo, '1.3.0', { date: '2026-10-25' })
    expect(plan.tag).toBe('v1.3.0')
    expect(plan.changelog).toContain('- after 1.2.0')
    expect(plan.changelog).not.toContain('released by hand')
    expect(plan.files.get(join(repo, 'package.json'))).toContain('"version": "1.3.0"')
    expect(() => planRelease(repo, '1.2.0')).toThrow('not above the current version')

    release(repo, '1.3.0', { date: '2026-10-25', skipChecks: true, log: () => {} })
    expect(git('tag', '--list')).toBe('v1.3.0')
    expect(git('log', '-1', '--format=%s')).toBe('chore(release): v1.3.0')
    expect(readFileSync(join(repo, 'CHANGELOG.md'), 'utf8')).toContain('## 1.3.0 (2026-10-25)')
    expect(lastRelease(repo)).toBe('v1.3.0')

    commit('feat: after the tag')
    expect(planRelease(repo, '1.4.0').changelog).toMatch(/after the tag[^]*$/)
    expect(planRelease(repo, '1.4.0').changelog).not.toContain('after 1.2.0')
  })

  test('refuses a dirty working tree and an existing tag', () => {
    setupRepo()
    writeFileSync(join(repo, 'src.txt'), 'dirty\n')
    expect(() => release(repo, '1.3.0', { skipChecks: true, log: () => {} })).toThrow(
      'the working tree has changes',
    )
    git('checkout', '--', 'src.txt')
    git('tag', 'v1.3.0')
    expect(() => release(repo, '1.3.0', { skipChecks: true, log: () => {} })).toThrow(
      'already exists',
    )
  })
})
