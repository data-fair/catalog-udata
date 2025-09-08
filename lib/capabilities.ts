import type { Capability } from '@data-fair/types-catalogs'

export const capabilities = [
  'search',
  'pagination',

  'import',
  'importConfig',

  'importFilters',

  'publication',
  'createFolderInRoot',
  'createResource',
  'replaceFolder',
  'replaceResource'
] satisfies Capability[]

export type UDataCapabilities = typeof capabilities
export default capabilities
