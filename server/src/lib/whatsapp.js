/**
 * WhatsApp journey alerts (client 2026-11-16, answer 10) — a stub, OFF.
 *
 * The plan (design §A.5): Meta's WhatsApp Cloud API, POST
 * /{phone-number-id}/messages with an approved utility template, to User.mobile
 * in E.164. It needs WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID and
 * WHATSAPP_TEMPLATE, which only exist once the client provides a verified
 * Meta Business account, a sending number, an approved template, a payment
 * method and the recipients' opt-in. Until then this reports "not configured",
 * the Journey settings panel shows "Setup needed", and nothing is sent.
 */

export const isConfigured = () =>
  Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_TEMPLATE)

/** Always { status: 'SKIPPED_NOT_CONFIGURED' } in phase 1. */
export async function sendTemplate() {
  return { status: 'SKIPPED_NOT_CONFIGURED' }
}
