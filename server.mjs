import { createServer } from 'node:http'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, createReadStream } from 'node:fs'
import { resolve, join } from 'node:path'

const passwords = { thomas: process.env.ZELLER_THOMAS_PASSWORD, ami: process.env.ZELLER_AMI_PASSWORD }
if (Object.values(passwords).some(password => !password || password.length < 12)) {
  throw new Error('Définis ZELLER_THOMAS_PASSWORD et ZELLER_AMI_PASSWORD (12 caractères minimum).')
}
const origin = new URL(process.env.PUBLIC_ORIGIN || 'http://localhost:3000').origin
const secure = origin.startsWith('https:')
const root = resolve(process.env.DATA_DIR || './data')
const files = join(root, 'files')
mkdirSync(files, { recursive: true, mode: 0o700 })
const database = join(root, 'library.json')
let library = existsSync(database) ? JSON.parse(readFileSync(database, 'utf8')) : { courses: [], folders: [] }
const page = readFileSync(new URL('./index.html', import.meta.url))
const sessions = new Map()
const attempts = new Map()
const lifetime = 8 * 60 * 60 * 1000
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/
const digest = value => createHash('sha256').update(value).digest()
const cookie = (token, age) => `zeller=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`
setInterval(() => {
  for (const [token, session] of sessions) if (session.expires <= Date.now()) sessions.delete(token)
  for (const [ip, attempt] of attempts) if (attempt.expires <= Date.now()) attempts.delete(ip)
}, 60000).unref()

function persist(next) {
  writeFileSync(database + '.tmp', JSON.stringify(next), { mode: 0o600, flush: true })
  renameSync(database + '.tmp', database)
  library = next
}
function fail(status, message) { throw Object.assign(new Error(message), { status }) }
function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}
async function body(request, limit) {
  if (Number(request.headers['content-length']) > limit) fail(413, 'Fichier ou cours trop volumineux.')
  const chunks = []
  let size = 0
  // Keep the connection open long enough to report an over-limit request.
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length
    if (size > limit) {
      request.resume()
      fail(413, 'Fichier ou cours trop volumineux.')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
async function readJSON(request, limit = 8192) {
  const data = await body(request, limit)
  try { return JSON.parse(data.toString()) }
  catch { fail(400, 'Données invalides.') }
}
function validCourse(course) {
  return course && uuid.test(course.id)
    && ['title', 'matter', 'chapter', 'folder'].every(key => typeof course[key] === 'string' && course[key].length <= 300)
    && typeof course.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(course.date)
    && typeof course.html === 'string' && Number.isInteger(course.rev)
    && Array.isArray(course.files) && course.files.length <= 100
    && course.files.every(file => file && uuid.test(file.id) && typeof file.name === 'string'
      && file.name.length <= 255 && existsSync(join(files, file.id)))
}

createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'")
  try {
    const path = new URL(request.url, origin).pathname
    const method = request.method
    if (method === 'GET' && (path === '/' || path === '/index.html')) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return response.end(page)
    }
    if (method !== 'GET' && request.headers.origin !== origin) fail(403, 'Origine refusée.')
    if (method === 'POST' && path === '/api/login') {
      const { username, password } = await readJSON(request) || {}
      const ip = request.socket.remoteAddress
      let attempt = attempts.get(ip)
      if (!attempt || attempt.expires <= Date.now()) {
        attempt = { count: 0, expires: Date.now() + 5 * 60 * 1000 }
        attempts.set(ip, attempt)
      }
      if (attempt.count >= 15) fail(429, 'Trop de tentatives. Réessaie dans quelques minutes.')
      if (!Object.hasOwn(passwords, username) || typeof password !== 'string'
        || !timingSafeEqual(digest(password), digest(passwords[username]))) {
        attempt.count++
        fail(401, 'Identifiant ou mot de passe incorrect.')
      }
      attempts.delete(ip)
      const token = randomUUID()
      sessions.set(token, { username, expires: Date.now() + lifetime })
      response.setHeader('Set-Cookie', cookie(token, lifetime / 1000))
      return json(response, 200, { username })
    }
    const token = request.headers.cookie?.match(/(?:^|;\s*)zeller=([a-f0-9-]+)/)?.[1]
    const session = sessions.get(token)
    if (!session || session.expires <= Date.now()) fail(401, 'Reconnecte-toi pour accéder à la bibliothèque.')
    if (method === 'POST' && path === '/api/logout') {
      sessions.delete(token)
      response.setHeader('Set-Cookie', cookie('', 0))
      return json(response, 200, {})
    }
    if (method === 'GET' && path === '/api/library') {
      return json(response, 200, { ...library, username: session.username })
    }
    if (method === 'POST' && path === '/api/folders') {
      const { name } = await readJSON(request) || {}
      if (typeof name !== 'string' || !name.trim() || name.length > 80) fail(400, 'Nom de dossier invalide.')
      if (!library.folders.includes(name)) persist({ ...library, folders: [...library.folders, name] })
      return json(response, 200, { folders: library.folders })
    }
    if (method === 'PUT' && path === '/api/courses') {
      const course = await readJSON(request, 8 * 1024 * 1024)
      if (!validCourse(course)) fail(400, 'Cours invalide.')
      const previous = library.courses.find(item => item.id === course.id)
      if (course.rev !== (previous?.rev || 0)) fail(409, 'Ce cours a été modifié sur un autre appareil. Enregistre ton brouillon comme copie.')
      const saved = { ...course, updated: Date.now(), rev: course.rev + 1 }
      const courses = previous ? library.courses.map(item => item.id === saved.id ? saved : item) : [...library.courses, saved]
      persist({ ...library, courses })
      return json(response, 200, { rev: saved.rev, updated: saved.updated })
    }
    if (method === 'POST' && path === '/api/files') {
      const data = await body(request, 20 * 1024 * 1024)
      const id = randomUUID()
      writeFileSync(join(files, id), data, { mode: 0o600, flag: 'wx' })
      return json(response, 201, { id })
    }
    const id = path.startsWith('/api/files/') ? path.slice(11) : ''
    if (method === 'GET' && uuid.test(id) && existsSync(join(files, id))) {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment' })
      const stream = createReadStream(join(files, id))
      stream.on('error', error => response.destroy(error))
      return stream.pipe(response)
    }
    fail(404, 'Page introuvable.')
  } catch (error) {
    if (!error.status) console.error(error)
    if (!response.headersSent && !response.destroyed) json(response, error.status || 500, { error: error.status ? error.message : 'Enregistrement indisponible. Réessaie.' })
  }
}).listen(Number(process.env.PORT || 3000), '0.0.0.0')
