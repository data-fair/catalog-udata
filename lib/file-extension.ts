import path from 'node:path'

/**
 * Determine the extension of a downloaded resource file.
 *
 * Gzipped files keep their inner extension (decp.csv.gz → .csv.gz): data-fair only accepts
 * a gzip file when the name without ".gz" has a recognized extension.
 */
export const getFileExtension = (urlPath: string, format?: string, contentType?: string): string => {
  const extension = path.extname(urlPath).toLowerCase()

  if (extension === '.gz') {
    const innerExtension = path.extname(path.basename(urlPath, path.extname(urlPath))).toLowerCase()
    if (innerExtension) return `${innerExtension}.gz`
    // No inner extension in the URL, fall back on the udata format (e.g. "csv" or "csv.gz")
    const innerFormat = format?.toLowerCase().trim().replace(/^\./, '').replace(/\.?gz(ip)?$/, '')
    if (innerFormat && /^[a-z0-9]+$/.test(innerFormat)) return `.${innerFormat}.gz`
    return '.gz'
  }

  if (extension) return extension

  if (contentType?.includes('json')) return '.json'
  if (contentType?.includes('csv')) return '.csv'
  if (contentType?.includes('xml')) return '.xml'
  if (contentType?.includes('excel')) return '.xlsx'
  if (contentType?.includes('zip')) return '.zip'
  return '.dat'
}
