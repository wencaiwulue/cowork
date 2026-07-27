import { describe, expect, it } from 'vitest'
import { parseDesktopDeepLink } from '../main/deepLink'

describe('parseDesktopDeepLink', () => {
  it('parses claude resume session and cwd links', () => {
    expect(
      parseDesktopDeepLink(
        'claude://resume?session=session-1&cwd=%2Ftmp%2Fproject',
      ),
    ).toEqual({
      sessionId: 'session-1',
      cwd: '/tmp/project',
    })
  })

  it('parses dev resume links and ignores unrelated URLs', () => {
    expect(parseDesktopDeepLink('claude-dev://resume?cwd=/tmp/project')).toEqual({
      cwd: '/tmp/project',
      sessionId: undefined,
    })
    expect(parseDesktopDeepLink('claude://other?cwd=/tmp/project')).toEqual({})
    expect(parseDesktopDeepLink('not a url')).toEqual({})
  })

  it('ignores unsafe resume cwd values without dropping safe session ids', () => {
    expect(parseDesktopDeepLink('claude://resume?cwd=relative/project')).toEqual({})
    expect(parseDesktopDeepLink('claude://resume?cwd=file:///tmp/project')).toEqual({})
    expect(parseDesktopDeepLink('claude://resume?cwd=/tmp/project%0Aopen')).toEqual({})
    expect(parseDesktopDeepLink(`claude://resume?cwd=/${'a'.repeat(4097)}`)).toEqual({})
    expect(parseDesktopDeepLink('claude://resume?session=session-1&cwd=relative/project')).toEqual({
      sessionId: 'session-1',
      cwd: undefined,
    })
  })

  it('accepts absolute local cwd shapes and rejects unsafe session ids', () => {
    expect(parseDesktopDeepLink('claude://resume?cwd=C:%5CUsers%5Cme%5Cproject')).toEqual({
      cwd: 'C:\\Users\\me\\project',
      sessionId: undefined,
    })
    expect(parseDesktopDeepLink('claude://resume?session=session%0A1&cwd=/tmp/project')).toEqual({
      sessionId: undefined,
      cwd: '/tmp/project',
    })
  })
})
