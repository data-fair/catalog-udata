import type { Capability } from '@data-fair/types-catalogs'

export const capabilities = [
  'search',
  'pagination',

  'import',
  'importConfig',

  'importFilters',

  'createFolderInRoot',
  'createResource',
  'replaceFolder',
  'replaceResource',
  'requiresPublicationSite'
] satisfies Capability[]

export type UDataCapabilities = typeof capabilities
export default capabilities
