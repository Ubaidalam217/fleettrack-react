import { describe, it, expect } from 'vitest'
import { admin as A } from '../../data/adapters'
import { emptyAdmin, ADMIN_ROLES } from './mockData'

describe('admin accounts (Users panel)', () => {
  it('a new GGB admin carries only its GGB, a group admin only its group', () => {
    expect(emptyAdmin(ADMIN_ROLES.GGB_ADMIN, 'g1')).toMatchObject({ role: 'GGB_ADMIN', ggbId: 'g1', groupId: '' })
    expect(emptyAdmin(ADMIN_ROLES.GROUP_ADMIN, 'gr1')).toMatchObject({ role: 'GROUP_ADMIN', ggbId: '', groupId: 'gr1' })
  })

  it('sends the scope link the server expects for each role', () => {
    const ggb = A.toApiCreate({ ...emptyAdmin('GGB_ADMIN', 'g1'), email: 'a@x.com', shortName: 'Ali' })
    expect(ggb).toEqual({ email: 'a@x.com', role: 'GGB_ADMIN', ggbId: 'g1', status: 'Active', shortName: 'Ali', mobile: null })
    const grp = A.toApiUpdate({ ...emptyAdmin('GROUP_ADMIN', 'gr1'), status: 'Inactive' })
    expect(grp).toMatchObject({ role: 'GROUP_ADMIN', groupId: 'gr1', status: 'Inactive' })
    expect(grp).not.toHaveProperty('ggbId')
  })

  it('reads the API row back into the panel shape', () => {
    const fe = A.toFe({ id: 'u1', role: 'GROUP_ADMIN', email: 'b@x.com', scope: { groupId: 'gr1' }, mustChangePassword: true, mobile: '050' })
    expect(fe).toMatchObject({ id: 'u1', role: 'GROUP_ADMIN', groupId: 'gr1', email: 'b@x.com', forceChange: true, mobile: '050', status: 'Active' })
  })
})
