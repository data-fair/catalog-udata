/**
 * axios `beforeRedirect` option for the requests carrying the udata API key.
 * X-API-KEY is a custom header: follow-redirects only strips Authorization and Cookie
 * on a cross-host redirect, so we remove it ourselves when a redirect leaves the catalog origin.
 */
export const dropApiKeyOnRedirect = (catalogUrl: string) => {
  const catalogOrigin = new URL(catalogUrl).origin
  return (options: Record<string, any>) => {
    if (new URL(`${options.protocol}//${options.host}`).origin === catalogOrigin) return
    for (const header of Object.keys(options.headers ?? {})) {
      if (header.toLowerCase() === 'x-api-key') delete options.headers[header]
    }
  }
}
