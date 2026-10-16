# Feedback relay

Lecture Studio's "Feedback" form posts here; this Vercel function mails the report (text, screenshots, files,
diagnostics) to the developer through Gmail. The app holds no secret: the mail password lives only in Vercel.

## Deploy (once)

1. Google Account → Security → 2-Step Verification on → **App passwords** → create one ("Lecture Studio").
2. Vercel → New Project → import this repository, **Root Directory: `feedback-relay`**, deploy.
3. Project → Settings → Environment Variables: `GMAIL_USER` (your Gmail), `GMAIL_APP_PASSWORD` (the app password),
   optionally `FEEDBACK_TO`. Redeploy.
4. Put the URL (`https://<project>.vercel.app/api/feedback`) into `backend/config.py: FEEDBACK_URL` and release.

Until then reports wait in each app's outbox (`<settings home>/feedback/outbox`) and go out once the URL works.

## Limits

Checked by the app and again here: 5 files + diagnostics, 4 MB together (Vercel takes 4.5 MB per request), allowed
types only, message 10–5000 characters, a honeypot field, 30 s between reports and 20 a day per IP (per warm instance).
Gmail itself sends up to 500 mails a day. To cut off abuse: revoke the app password.
