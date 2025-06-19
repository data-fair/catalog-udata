import type { CatalogPlugin } from '@data-fair/lib-common-types/catalog/index.js'
import { schema as configSchema, assertValid as assertConfigValid, type UDataConfig } from './types/config/index.ts'
import listFiltersSchema from './lib/listFiltersSchema.ts'
import capabilities from './lib/capabilities.ts'

const plugin: CatalogPlugin<UDataConfig, typeof capabilities> = {

  async list (context) {
    const { list } = await import('./lib/imports.ts')
    return list(context)
  },

  async getResource (catalogConfig, resourceId) {
    const { getResource } = await import('./lib/imports.ts')
    return getResource(catalogConfig, resourceId)
  },

  async downloadResource (context) {
    const { downloadResource } = await import('./lib/imports.ts')
    return downloadResource(context)
  },

  async publishDataset (context) {
    const { publishDataset } = await import('./lib/publications.ts')
    return publishDataset(context)
  },

  async deleteDataset (context) {
    const { deleteDataset } = await import('./lib/publications.ts')
    return deleteDataset(context)
  },

  metadata: {
    title: 'Catalog Udata',
    description: 'Importez / publiez des jeux de données depuis / vers un catalogue Udata. (ex. : data.gouv.fr)',
    capabilities
  },

  listFiltersSchema,
  configSchema,
  assertConfigValid
}
export default plugin
