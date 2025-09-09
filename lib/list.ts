import type { CatalogPlugin, ListContext, Folder } from '@data-fair/types-catalogs'
import type { UDataConfig } from '#types'
import type { UDataCapabilities } from './capabilities.ts'
import axios from '@data-fair/lib-node/axios.js'

export const list = async ({ catalogConfig, secrets, params }: ListContext<UDataConfig, UDataCapabilities>): ReturnType<CatalogPlugin['list']> => {
  if (params.action && !secrets.apiKey) throw new Error('API key is required to list datasets for publication')

  const axiosOptions: Record<string, any> = { headers: {}, params: {} }
  if (secrets.apiKey) axiosOptions.headers['X-API-KEY'] = secrets.apiKey
  if (params.q) axiosOptions.params.q = params.q

  if (params.currentFolderId) { // We are inside a dataset, fetch its resources
    const dataset = (await axios.get(new URL(`api/1/datasets/${params.currentFolderId}`, catalogConfig.url).href, axiosOptions)).data

    type ResourceResponse = Awaited<ReturnType<CatalogPlugin['list']>>['results'][number]

    // Convert the dataset resources to ResourceList format
    const resources = (dataset.resources || []).map((udataResource: any) => ({
      id: `${dataset.id}:${udataResource.id}`,
      title: udataResource.title,
      type: 'resource',
      description: dataset.description,
      format: udataResource.format || 'unknown',
      origin: dataset.page,
      mimeType: udataResource.mime,
      size: udataResource.filesize
    } as ResourceResponse))

    // Build the path with the dataset folder
    const path: Folder[] = [{
      id: dataset.id,
      title: dataset.title,
      type: 'folder'
    }]

    return {
      count: resources.length,
      results: resources,
      path
    }
  }

  // If no currentFolderId, we list datasets as folders (root level)
  let datasets
  let count
  if (!params.action && params.showAll === 'true') {
    if (params.size && params.page) axiosOptions.params = { ...axiosOptions.params, page: params.page, page_size: params.size }
    axiosOptions.params.organization = params.organization
    const result = (await axios.get(new URL('api/1/datasets/', catalogConfig.url).href, axiosOptions)).data
    datasets = result.data
    count = result.total
  } else {
    datasets = (await axios.get(new URL('api/1/me/org_datasets', catalogConfig.url).href, axiosOptions)).data
    if (params.action !== 'replaceFolder') datasets = datasets.filter((d: any) => !d.deleted)

    // Filter out datasets with "Consultez les données" resources for create/replace resource actions
    if (params.action === 'createResource' || params.action === 'replaceResource') {
      const filteredDatasets = []
      for (const dataset of datasets) {
        try {
          const datasetDetails = (await axios.get(new URL(`api/1/datasets/${dataset.id}`, catalogConfig.url).href, axiosOptions)).data
          const hasConsultezResource = (datasetDetails.resources || []).some((resource: any) =>
            resource.title?.includes('Consultez les données')
          )
          if (!hasConsultezResource) {
            filteredDatasets.push(dataset)
          }
        } catch (error) {
          // In case of error fetching dataset details, include it in the list
          filteredDatasets.push(dataset)
        }
      }
      datasets = filteredDatasets
    }

    count = datasets.length // Count before pagination
    if (params.size && params.page) {
      const startIndex = (params.page - 1) * params.size
      const endIndex = startIndex + Number(params.size)
      datasets = datasets.slice(startIndex, endIndex)
    }
  }

  // Convert datasets to folders
  const folders = datasets.map((dataset: any) => ({
    id: dataset.id,
    title: dataset.deleted && params.action === 'replaceFolder' ? `[Supprimé] ${dataset.title}` : dataset.title,
    type: 'folder'
  } as Folder))

  return {
    count,
    results: folders,
    path: [] // Empty path for root level
  }
}
