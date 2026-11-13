import { describe, it, expect } from 'vitest'
import { withEpisode } from './alertEvents'

describe('alert event episode fields', () => {
  it('passes an ended episode through', () => {
    const e = withEpisode({ id: 'a', occurredAt: '2026-11-13T08:00:00.000Z', endedAt: '2026-11-13T08:02:00.000Z', durationSec: 120, peakValue: 153 })
    expect(e).toMatchObject({ id: 'a', endedAt: '2026-11-13T08:02:00.000Z', durationSec: 120, peakValue: 153 })
  })

  it('reads an open episode, an instant event and an older server as nulls', () => {
    expect(withEpisode({ id: 'b', endedAt: null, durationSec: null, peakValue: null })).toMatchObject({ endedAt: null, durationSec: null, peakValue: null })
    const older = withEpisode({ id: 'c' })
    expect(older).toEqual({ id: 'c', endedAt: null, durationSec: null, peakValue: null })
    expect(withEpisode({ id: 'd', durationSec: '60', peakValue: NaN })).toMatchObject({ durationSec: null, peakValue: null })
  })
})
