import type { CatalogPlugin, CatalogMetadata, CatalogDataset, Publication } from '@data-fair/lib-common-types/catalog.js'

import { schema as configSchema, assertValid as assertConfigValid, type UDataConfig } from './types/config/index.ts'
import { prepareDatasetFromCatalog, createOrUpdateDataset, deleteUdataDataset } from './lib/utils.ts'
import axios from '@data-fair/lib-node/axios.js'

// API Reference: https://doc.data.gouv.fr/api/reference/#/
// OpenAPI Reference: https://www.data.gouv.fr/api/1/swagger.json

const listDatasets = async (catalogConfig: UDataConfig, params?: { q?: string }) => {
  const axiosOptions = { headers: { 'X-API-KEY': catalogConfig.apiKey } }

  let datasets
  if (catalogConfig.organization) {
    const distantDatasets: { data: { organization?: { id: string } }[] } =
      await axios.get(new URL('api/1/me/org_datasets', catalogConfig.url).href, axiosOptions)
    datasets = distantDatasets.data.filter(d => d.organization?.id === catalogConfig.organization!.id)
  } else {
    datasets = (await axios.get(new URL('api/1/me/datasets', catalogConfig.url).href, axiosOptions)).data
  }
  datasets = datasets.filter((d: any) => !d.deleted)

  return {
    count: datasets.length,
    results: datasets.map((d: any) => prepareDatasetFromCatalog(catalogConfig, d)) as CatalogDataset[]
  }
}

const getDataset = async (catalogConfig: UDataConfig, datasetId: string) => {
  const udataDataset = (await axios.get(new URL('api/1/datasets/' + datasetId, catalogConfig.url).href, { headers: { 'X-API-KEY': catalogConfig.apiKey } })).data
  return prepareDatasetFromCatalog(catalogConfig, udataDataset)
}

const publishDataset = async (catalogConfig: UDataConfig, dataset: any, publication: Publication): Promise<Publication> => {
  // if (publication.addToDataset.id) return addResourceToDataset(catalogConfig, dataset, publication)
  // else return createOrUpdateDataset(catalogConfig, dataset, publication)
  return await createOrUpdateDataset(catalogConfig, dataset, publication)
}

const deleteDataset = async (catalogConfig: UDataConfig, datasetId: string) => {
  // if (publication.addToDataset && publication.addToDataset.id) return deleteResourceFromDataset(catalog, dataset, publication)
  // else return deleteUdataDataset(catalog, dataset, publication)
  await deleteUdataDataset(catalogConfig, datasetId)
}

const metadata: CatalogMetadata = {
  title: 'Catalog Udata',
  description: 'Importez / publiez des jeux de données depuis / vers un catalogue Udata (ex. : data.gouv.fr)',
  icon: 'M6,22A3,3 0 0,1 3,19C3,18.4 3.18,17.84 3.5,17.37L9,7.81V6A1,1 0 0,1 8,5V4A2,2 0 0,1 10,2H14A2,2 0 0,1 16,4V5A1,1 0 0,1 15,6V7.81L20.5,17.37C20.82,17.84 21,18.4 21,19A3,3 0 0,1 18,22H6M5,19A1,1 0 0,0 6,20H18A1,1 0 0,0 19,19C19,18.79 18.93,18.59 18.82,18.43L16.53,14.47L14,17L8.93,11.93L5.18,18.43C5.07,18.59 5,18.79 5,19M13,10A1,1 0 0,0 12,11A1,1 0 0,0 13,12A1,1 0 0,0 14,11A1,1 0 0,0 13,10Z',
  capabilities: [
    'listDatasets',
    'publishDataset'
  ]
}

const plugin: CatalogPlugin<UDataConfig> = {
  listDatasets,
  getDataset,
  publishDataset,
  deleteDataset,
  configSchema,
  assertConfigValid,
  metadata
}
export default plugin
