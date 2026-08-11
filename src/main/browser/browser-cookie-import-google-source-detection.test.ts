import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const { sessionFromPartitionMock } = vi.hoisted(() => ({
  sessionFromPartitionMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  session: { fromPartition: sessionFromPartitionMock }
}))

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))

vi.mock('./browser-session-registry', () => ({
  browserSessionRegistry: {
    setPendingCookieImport: vi.fn(),
    clearPendingCookieImport: vi.fn()
  }
}))

import { importCookiesFromBrowser, type DetectedBrowser } from './browser-cookie-import'

function buildSafariCookie(domain: string, name: string, expiration: number): Buffer {
  const strings = [domain, name, '/', 'value']
  let cursor = 48
  const offsets = strings.map((text) => {
    const offset = cursor
    cursor += Buffer.byteLength(text) + 1
    return offset
  })
  const cookie = Buffer.alloc(cursor)
  cookie.writeUInt32LE(cookie.length, 0)
  cookie.writeUInt32LE(offsets[0], 16)
  cookie.writeUInt32LE(offsets[1], 20)
  cookie.writeUInt32LE(offsets[2], 24)
  cookie.writeUInt32LE(offsets[3], 28)
  cookie.writeDoubleLE(expiration, 40)
  strings.forEach((text, index) => cookie.write(text, offsets[index], 'utf8'))
  return cookie
}

function buildSafariCookieFile(cookies: readonly Buffer[]): Buffer {
  const headerSize = 8 + cookies.length * 4
  const pageSize = headerSize + cookies.reduce((total, cookie) => total + cookie.length, 0)
  const page = Buffer.alloc(pageSize)
  page.writeUInt32BE(0x00000100, 0)
  page.writeUInt32LE(cookies.length, 4)
  let offset = headerSize
  cookies.forEach((cookie, index) => {
    page.writeUInt32LE(offset, 8 + index * 4)
    cookie.copy(page, offset)
    offset += cookie.length
  })
  const file = Buffer.alloc(12 + page.length)
  file.write('cook', 0, 'utf8')
  file.writeUInt32BE(1, 4)
  file.writeUInt32BE(page.length, 8)
  page.copy(file, 12)
  return file
}

describe('Google source snapshot detection for browser imports', () => {
  let tmpDir: string
  let cookiesSetMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'orca-cookie-source-test-'))
    cookiesSetMock = vi.fn().mockResolvedValue(undefined)
    sessionFromPartitionMock.mockReset().mockReturnValue({
      cookies: {
        get: vi.fn().mockResolvedValue([]),
        remove: vi.fn().mockResolvedValue(undefined),
        set: cookiesSetMock
      }
    })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('checks Firefox rows before expiry filtering', async () => {
    const cookiesPath = join(tmpDir, 'cookies.sqlite')
    const db = new DatabaseSync(cookiesPath)
    db.exec(`CREATE TABLE moz_cookies (
      name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER,
      isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER
    )`)
    const insert = db.prepare('INSERT INTO moz_cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    const now = Math.floor(Date.now() / 1000)
    insert.run('expired-google', 'g', '.google.com', '/', now - 60, 1, 1, 0)
    insert.run('session', 'valid', '.example.com', '/', now + 3600, 1, 1, 0)
    db.close()

    const result = await importCookiesFromBrowser(browser('firefox', cookiesPath), 'persist:test')

    expect(result.ok && result.summary).toMatchObject({
      googleCookiesPresent: true,
      domains: ['example.com']
    })
    expect(cookiesSetMock).toHaveBeenCalledTimes(1)
  })

  it('checks decoded Safari cookies before expiry filtering', async () => {
    const cookiesPath = join(tmpDir, 'Cookies.binarycookies')
    writeFileSync(
      cookiesPath,
      buildSafariCookieFile([
        buildSafariCookie('.google.com', 'expired-google', 1),
        buildSafariCookie('.example.com', 'session', 4_000_000_000)
      ])
    )

    const result = await importCookiesFromBrowser(browser('safari', cookiesPath), 'persist:test')

    expect(result.ok && result.summary).toMatchObject({
      googleCookiesPresent: true,
      domains: ['example.com']
    })
    expect(cookiesSetMock).toHaveBeenCalledTimes(1)
  })
})

function browser(family: 'firefox' | 'safari', cookiesPath: string): DetectedBrowser {
  return {
    family,
    label: family === 'firefox' ? 'Firefox' : 'Safari',
    cookiesPath,
    profiles: [],
    selectedProfile: 'Default'
  }
}
