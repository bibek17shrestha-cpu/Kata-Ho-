// Sends transactional email via Resend (https://resend.com). Uses their
// plain HTTP API with a global fetch — no extra npm package needed
// (Node 18+ has fetch built in).
//
// Setup (one-time):
//   1. Sign up at resend.com (free tier: 3,000 emails/month, no card needed)
//   2. Verify a sending domain, OR use their shared test domain for
//      development (onboarding@resend.dev — works immediately, no
//      domain setup, but only sends to your own verified email while
//      testing without a custom domain).
//   3. Create an API key in the Resend dashboard.
//   4. Set RESEND_API_KEY as an environment variable in Render.
//   5. Set EMAIL_FROM (e.g. "Kata Ho <onboarding@resend.dev>" for testing,
//      or your own verified address once you add a domain).
//
// If RESEND_API_KEY isn't set, sendEmail() logs a warning and returns
// false instead of throwing — the rest of the app keeps working.

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'Kata Ho <onboarding@resend.dev>';

async function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    console.error('Missing RESEND_API_KEY — email not sent. Subject was:', subject);
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: EMAIL_FROM, to, subject, html })
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('Resend send failed:', res.status, body);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Resend send error:', err.message);
    return false;
  }
}

module.exports = { sendEmail };
