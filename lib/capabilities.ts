import type { Capability } from '@data-fair/types-catalogs'

export const capabilities = [
  'import',
  'search',
  'pagination',
  'additionalFilters',
  'publishDataset',
  'deletePublication',
] satisfies Capability[]

export type UDataCapabilities = typeof capabilities
export default capabilities
