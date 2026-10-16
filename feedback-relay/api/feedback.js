/**
 * Lecture Studio feedback relay: one POST from the app (multipart: report fields + files) -> one mail to the developer.
 *
 * The app holds no secret; this function does (Vercel environment variables):
 *   GMAIL_USER          the Gmail address that sends (and receives, unless FEEDBACK_TO is set)
 *   GMAIL_APP_PASSWORD  a Google "app password" for it (Google Account -> Security -> App passwords), not the real one
 *   FEEDBACK_TO         optional: where reports go
 *
 * Anyone can call this URL, so it checks everything again: the app header, size and count of files, file types,
 * message length, a honeypot, and a per-IP rate limit (best effort: memory of one warm instance).
 */
import Busboy from 'busboy'
import nodemailer from 'nodemailer'

const MAX_BODY = 4.5 * 1024 * 1024 // Vercel's request limit
const MAX_FILES = 6 // 5 from the user + diagnostics.txt
const MAX_FILE = 4 * 1024 * 1024
const MIN_MESSAGE = 10
const MAX_MESSAGE = 5000
const EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic', '.pdf', '.txt', '.log', '.md', '.json', '.zip']
const KINDS = { bug: 'Баг', idea: 'Идея', other: 'Другое' }
const COOLDOWN_MS = 30_000
const DAILY_PER_IP = 20

const seen = new Map() // ip -> send times (ms), this instance only

function limited(ip) {
  const now = Date.now()
  const times = (seen.get(ip) || []).filter((t) => now - t < 24 * 3600 * 1000)
  if (times.length && now - times[times.length - 1] < COOLDOWN_MS) return true
  if (times.length >= DAILY_PER_IP) return true
  seen.set(ip, [...times, now])
  return false
}

function parse(req) {
  return new Promise((resolve, reject) => {
    const fields = {}
    const files = []
    let failed = null
    const bb = Busboy({ headers: req.headers, limits: { files: MAX_FILES, fileSize: MAX_FILE, fields: 20, fieldSize: 20_000 } })
    bb.on('field', (name, value) => (fields[name] = value))
    bb.on('file', (name, stream, info) => {
      const ext = (info.filename.match(/\.[^.]+$/) || [''])[0].toLowerCase()
      if (!EXTENSIONS.includes(ext)) {
        failed = `file type ${ext || '?'}`
        stream.resume()
        return
      }
      const chunks = []
      stream.on('data', (c) => chunks.push(c))
      stream.on('limit', () => (failed = 'file too big'))
      stream.on('end', () => files.push({ filename: info.filename, content: Buffer.concat(chunks), contentType: info.mimeType }))
    })
    bb.on('filesLimit', () => (failed = 'too many files'))
    bb.on('error', reject)
    bb.on('close', () => (failed ? reject(new Error(failed)) : resolve({ fields, files })))
    req.pipe(bb)
  })
}

const reply = (res, status, body) => res.status(status).json(body)

export default async function handler(req, res) {
  if (req.method !== 'POST') return reply(res, 405, { error: 'POST only' })
  if (!req.headers['x-lecture-studio']) return reply(res, 403, { error: 'not from the app' })
  if (Number(req.headers['content-length'] || 0) > MAX_BODY) return reply(res, 413, { error: 'too big' })
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown'
  if (limited(ip)) return reply(res, 429, { error: 'slow down' })

  let report
  try {
    report = await parse(req)
  } catch (e) {
    return reply(res, 400, { error: String(e.message || e) })
  }
  const f = report.fields
  if (f.website) return reply(res, 200, { ok: true }) // honeypot: quietly dropped
  const message = String(f.message || '').trim()
  if (message.length < MIN_MESSAGE || message.length > MAX_MESSAGE) return reply(res, 400, { error: 'message length' })
  const kind = KINDS[f.kind] ? f.kind : 'other'
  const contact = String(f.contact || '').slice(0, 200)

  const { GMAIL_USER, GMAIL_APP_PASSWORD, FEEDBACK_TO } = process.env
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return reply(res, 503, { error: 'relay not configured' })
  const transport = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } })
  const firstLine = message.split('\n')[0].slice(0, 70)
  try {
    await transport.sendMail({
      from: `Lecture Studio <${GMAIL_USER}>`,
      to: FEEDBACK_TO || GMAIL_USER,
      replyTo: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) ? contact : undefined,
      subject: `[Lecture Studio ${f.version || '?'}] ${KINDS[kind]}: ${firstLine}`,
      text: [
        message,
        '',
        '—',
        `Тип: ${KINDS[kind]}`,
        `Контакт: ${contact || 'не указан'}`,
        `Версия: ${f.version || '?'} · ${f.os || '?'} · интерфейс ${f.language || '?'}`,
        `Файлы: ${report.files.map((x) => x.filename).join(', ') || 'нет'}`,
      ].join('\n'),
      attachments: report.files,
    })
  } catch (e) {
    console.error('mail failed', e)
    return reply(res, 502, { error: 'mail failed' })
  }
  return reply(res, 200, { ok: true })
}
