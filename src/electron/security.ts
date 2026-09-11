import { app, session, shell } from 'electron'
import { log } from './logging.js'

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

/** Applies session-wide hardening before any page loads. */
export function applySecurityPolicies(allowedOrigin: () => string | undefined): void {
  const target = session.defaultSession
  target.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] },
    })
  })
  target.setPermissionRequestHandler((contents, permission, callback) => {
    const origin = allowedOrigin()
    const requestingUrl = contents.getURL()
    const isLocal = origin !== undefined && requestingUrl.startsWith(origin)
    const allowed = isLocal && (permission === 'geolocation' || permission === 'media')
    if (!allowed) log.warn(`Denied permission request: ${permission}`)
    callback(allowed)
  })
  target.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    const origin = allowedOrigin()
    const isLocal = origin !== undefined && requestingOrigin.startsWith(origin)
    return isLocal && (permission === 'geolocation' || permission === 'media')
  })
}

/**
 * Blocks in-app navigation away from the local app origin and routes external
 * links to the OS browser (http/https only). Applied to every webContents.
 */
export function installNavigationGuards(allowedOrigin: () => string | undefined): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      const origin = allowedOrigin()
      if (!origin || new URL(url).origin !== origin) {
        log.warn(`Blocked navigation to ${url}`)
        event.preventDefault()
      }
    })
    contents.setWindowOpenHandler(({ url }) => {
      openExternal(url)
      return { action: 'deny' }
    })
  })
}

function openExternal(url: string): void {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') void shell.openExternal(url)
  } catch {
    log.warn(`Ignored invalid external URL: ${url}`)
  }
}
