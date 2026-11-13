import { setNodeLogo } from '../../data/settings'

/**
 * After a new node is saved: upload its staged logo. A failure is reported but
 * does not undo the save — the logo can be added again from Edit.
 */
export async function uploadStagedLogo(kind, id, staged, push) {
  if (!staged || !id) return
  try {
    await setNodeLogo(kind, id, staged)
  } catch (err) {
    push(`Saved, but the logo could not be uploaded (${err?.message ?? 'error'}). Add it again from Edit.`, { tone: 'error' })
  }
}
