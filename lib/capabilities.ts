import type { Capability } from '@data-fair/types-catalogs'

export const capabilities = [
  'import',
  'search',
  'pagination',
  'additionalFilters',
  'importConfig',
  'publication'
] satisfies Capability[]

export type UDataCapabilities = typeof capabilities
export default capabilities
