/**
 * A last line of defence, installed before anything else runs: the demo never talks to another origin. Any attempt to fetch,
 * open a socket or beacon to a different host is refused in the browser itself (and logged), so even a mistake in a future
 * change could not reach a real backend. Same-origin requests (the demo's own files) and data:/blob: URLs are untouched.
 */
const here = () => new URL(window.location.href)

function isLocal(target: string | URL | Request): boolean {
  try {
    const url = new URL(typeof target === 'string' ? target : target instanceof URL ? target.href : target.url, here())
    if (url.protocol === 'data:' || url.protocol === 'blob:') return true
    return url.host === here().host
  } catch {
    return false
  }
}

const refuse = (what: string, target: unknown): never => {
  console.error(`[demo] Blocked ${what} to a different origin: ${String(target)}`)
  throw new TypeError('The interactive demo makes no external requests.')
}

export function installNetworkGuard(): void {
  const realFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    if (isLocal(input)) return realFetch(input, init)
    try { refuse('fetch', input) } catch (err) { return Promise.reject(err) }
    return Promise.reject(new TypeError('blocked'))
  }

  const realOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    if (!isLocal(url)) refuse('XMLHttpRequest', url)
    return (realOpen as (...a: unknown[]) => void).call(this, method, url, ...rest)
  } as typeof XMLHttpRequest.prototype.open

  if (typeof navigator.sendBeacon === 'function') {
    const realBeacon = navigator.sendBeacon.bind(navigator)
    navigator.sendBeacon = (url, data) => (isLocal(url) ? realBeacon(url, data) : (console.error(`[demo] Blocked beacon to ${String(url)}`), false))
  }

  window.WebSocket = new Proxy(window.WebSocket, {
    construct(target, args: [string | URL, (string | string[])?]) {
      if (!isLocal(String(args[0]).replace(/^ws/, 'http'))) refuse('WebSocket', args[0])
      return Reflect.construct(target, args)
    },
  })

  if (typeof window.EventSource === 'function') {
    window.EventSource = new Proxy(window.EventSource, {
      construct(target, args: [string | URL, EventSourceInit?]) {
        if (!isLocal(args[0])) refuse('EventSource', args[0])
        return Reflect.construct(target, args)
      },
    })
  }
}
