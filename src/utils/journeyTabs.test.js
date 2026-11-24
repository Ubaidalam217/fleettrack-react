import { describe, expect, it } from 'vitest'
import { activeTabKey, JOURNEY_TABS, visibleTabs } from './journeyTabs'

const RANK = { none: 0, view: 1, modify: 2, addDelete: 3 }
const may = level => need => RANK[level] >= RANK[need]
const open = (closed = []) => path => !closed.includes(path)

describe('visibleTabs', () => {
  it('shows all eight tabs to someone with Journeys = Edit', () => {
    expect(visibleTabs({ canOpen: open(), journeysAtLeast: may('modify') }).map(t => t.label)).toEqual([
      'Journeys', 'Live', 'New', 'Approvals', 'Alerts', 'Checkpoints & Routes', 'Route Optimization', 'Settings',
    ])
  })
  it('hides New and Route Optimization from a viewer', () => {
    const labels = visibleTabs({ canOpen: open(), journeysAtLeast: may('view') }).map(t => t.label)
    expect(labels).not.toContain('New')
    expect(labels).not.toContain('Route Optimization')
    expect(labels).toContain('Approvals')
  })
  it('hides a screen the user has no access to', () => {
    const labels = visibleTabs({ canOpen: open(['/journeys/alerts', '/journeys/settings']), journeysAtLeast: may('modify') }).map(t => t.label)
    expect(labels).not.toContain('Alerts')
    expect(labels).not.toContain('Settings')
    expect(labels).toHaveLength(6)
  })
})

describe('activeTabKey', () => {
  it('lights the tab of the path', () => {
    for (const t of JOURNEY_TABS) expect(activeTabKey(t.path)).toBe(t.key)
    expect(activeTabKey('/journeys/')).toBe('journeys')
  })
  it('a journey page and its edit form sit under Journeys', () => {
    expect(activeTabKey('/journeys/ckabc123')).toBe('journeys')
    expect(activeTabKey('/journeys/ckabc123/edit')).toBe('journeys')
  })
  it('anything else lights nothing', () => {
    expect(activeTabKey('/reports')).toBeNull()
    expect(activeTabKey('/journeys/a/b/c')).toBeNull()
  })
})
