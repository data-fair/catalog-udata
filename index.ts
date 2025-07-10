import type CatalogPlugin from '@data-fair/types-catalogs'
import { schema as configSchema, assertValid as assertConfigValid, type UDataConfig } from './types/catalogConfig/index.ts'
import listFiltersSchema from './lib/listFiltersSchema.ts'
import { type UDataCapabilities, capabilities } from './lib/capabilities.ts'

const plugin: CatalogPlugin<UDataConfig, UDataCapabilities> = {
  async prepare (context) {
    const prepare = (await import('./lib/prepare.ts')).default
    return prepare(context)
  },

  async listResources (context) {
    const { listResources } = await import('./lib/imports.ts')
    return listResources(context)
  },

  async getResource (context) {
    const { getResource } = await import('./lib/imports.ts')
    return getResource(context)
  },

  async listDatasets (context) {
    const { listDatasets } = await import('./lib/publications.ts')
    return listDatasets(context)
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
