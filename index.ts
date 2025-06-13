import type { CatalogPlugin, CatalogMetadata, ListContext, DownloadResourceContext } from '@data-fair/lib-common-types/catalog/index.js'
import { schema as configSchema, assertValid as assertConfigValid, type UDataConfig } from './types/config/index.ts'
import filtersSchema from './lib/filtersSchema.ts'
import capabilities from './lib/capabilities.ts'

const list = async (context: ListContext<UDataConfig, typeof capabilities>) => {
  const { list } = await import('./lib/imports.ts')
  return list(context)
}

const getResource = async (catalogConfig: UDataConfig, resourceId: string) => {
  const { getResource } = await import('./lib/imports.ts')
  return getResource(catalogConfig, resourceId)
}

const downloadResource = async (context: DownloadResourceContext<UDataConfig>) => {
  const { downloadResource } = await import('./lib/imports.ts')
  return downloadResource(context)
}

const publishDataset = async (catalogConfig: UDataConfig, dataset: any, publication: any) => {
  const { publishDataset } = await import('./lib/publications.ts')
  return publishDataset(catalogConfig, dataset, publication)
}

const deleteDataset = async (catalogConfig: UDataConfig, datasetId: string, resourceId?: string) => {
  const { deleteDataset } = await import('./lib/publications.ts')
  return deleteDataset(catalogConfig, datasetId, resourceId)
}

const metadata: CatalogMetadata<typeof capabilities> = {
  title: 'Catalog Udata',
  description: 'Importez / publiez des jeux de données depuis / vers un catalogue Udata. (ex. : data.gouv.fr)',
  capabilities
}

const plugin: CatalogPlugin<UDataConfig, typeof capabilities> = {
  list,
  getResource,
  downloadResource,
  publishDataset,
  deleteDataset,
  filtersSchema,
  configSchema,
  assertConfigValid,
  metadata
}

export default plugin
