// supabase/functions/notify-signup-outcome/index.ts
// S050 — sends the applicant an email via Resend when an admin approves or
// rejects their pending_signups row. Triggered by migration 0042 via pg_net.
//
// Pre-flight (one-time):
//   1. Sign up at https://resend.com (free tier, 100 emails/day, no card)
//   2. Create an API key, copy it
//   3. In Supabase dashboard → Functions → notify-signup-outcome → Settings,
//      add env var RESEND_API_KEY = re_xxxxx (this is the secret bit)
//   4. Optional: NOTIFY_FROM env var to override default sender. If you verify
//      a custom domain in Resend, use it (e.g. "FFC <noreply@yourdomain>");
//      else stick with the default "FFC <onboarding@resend.dev>".
//
// Auth model (mirrors notify-dispatch from S048):
//   * Authorization: Bearer <legacy-jwt>   — Supabase Functions gateway
//   * X-Dispatch-Secret: <shared-secret>   — caller auth inside the function

const DISPATCH_SHARED_SECRET = Deno.env.get('DISPATCH_SHARED_SECRET')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const NOTIFY_FROM = Deno.env.get('NOTIFY_FROM') ?? 'FFC <onboarding@resend.dev>'
const APP_URL = Deno.env.get('APP_URL') ?? 'https://ffc-gilt.vercel.app'

interface OutcomePayload {
  pending_signup_id: string
  email: string
  display_name: string
  resolution: 'approved' | 'rejected'
  rejection_reason: string | null
}

function buildEmail(p: OutcomePayload): { subject: string; html: string } {
  const safeName = p.display_name.replace(/[<>]/g, '')
  if (p.resolution === 'approved') {
    return {
      subject: 'Welcome to FFC',
      html: `
        <p>Hi ${safeName},</p>
        <p>You're approved &mdash; welcome to the FFC league.</p>
        <p>Sign in at <a href="${APP_URL}/login">${APP_URL}/login</a> to vote in the next match poll.</p>
        <p>See you on the pitch.</p>
        <p style="color:#888;font-size:12px;margin-top:32px">FFC &middot; Friends Football Club</p>
      `,
    }
  }
  // Rejected
  const reasonLine = p.rejection_reason
    ? `<p>Reason: ${p.rejection_reason.replace(/[<>]/g, '')}</p>`
    : ''
  return {
    subject: 'FFC signup update',
    html: `
      <p>Hi ${safeName},</p>
      <p>Your FFC signup wasn't approved this time.</p>
      ${reasonLine}
      <p>If you think this was a mistake, reply to this email.</p>
      <p style="color:#888;font-size:12px;margin-top:32px">FFC &middot; Friends Football Club</p>
    `,
  }
}

Deno.serve(async (req) => {
  // Caller auth.
  const dispatchSecret = req.headers.get('x-dispatch-secret') ?? ''
  if (dispatchSecret !== DISPATCH_SHARED_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!RESEND_API_KEY) {
    console.error('notify-signup-outcome: RESEND_API_KEY not configured')
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let payload: OutcomePayload
  try {
    payload = await req.json()
    if (!payload.email || !payload.display_name || !payload.resolution) {
      throw new Error('missing required field(s)')
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: 'bad request', detail: String(e) }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { subject, html } = buildEmail(payload)

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: NOTIFY_FROM,
      to: [payload.email],
      subject,
      html,
    }),
  })

  if (!res.ok) {
    const detail = await res.text()
    console.error('notify-signup-outcome: Resend send failed', {
      status: res.status,
      detail,
      pending_signup_id: payload.pending_signup_id,
    })
    return new Response(
      JSON.stringify({ error: 'resend send failed', status: res.status, detail }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const sent = await res.json().catch(() => ({}))
  return new Response(
    JSON.stringify({
      ok: true,
      resend_id: (sent as { id?: string }).id ?? null,
      resolution: payload.resolution,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
})
