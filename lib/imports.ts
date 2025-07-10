import type { CatalogPlugin, ListResourcesContext, Folder, Resource, GetResourceContext } from '@data-fair/types-catalogs'
import type { UDataConfig } from '#types'
import type { UDataCapabilities } from './capabilities.ts'

import axios from '@data-fair/lib-node/axios.js'

export const listResources = async ({ catalogConfig, secrets, params }: ListResourcesContext<UDataConfig, UDataCapabilities>): ReturnType<CatalogPlugin['listResources']> => {
  const axiosOptions: Record<string, any> = { headers: {}, params: {} }
  if (secrets.apiKey) axiosOptions.headers['X-API-KEY'] = secrets.apiKey
  if (params.q) axiosOptions.params.q = params.q

  // If currentFolderId is present, we retrieve the resources of the dataset
  if (params.currentFolderId) {
    // Get the specific dataset
    const datasetResponse = await axios.get(new URL(`api/1/datasets/${params.currentFolderId}`, catalogConfig.url).href, axiosOptions)
    const dataset = datasetResponse.data

    type ResourceList =
      Pick<
        Resource,
        'id' | 'title' | 'description' | 'format' | 'mimeType' | 'origin' | 'size'
      > & {
        type: 'resource'
      }

    // Convert the dataset resources to ResourceList format
    const resources = (dataset.resources || []).map((udataResource: any) => ({
      id: `${dataset.id}:${udataResource.id}`,
      title: udataResource.title,
      type: 'resource' as const,
      description: dataset.description,
      format: udataResource.format || 'unknown',
      origin: dataset.page,
      mimeType: udataResource.mime,
      size: udataResource.filesize
    } as ResourceList))

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
  if (params.showAll === 'true') {
    if (params.size && params.page) axiosOptions.params = { ...axiosOptions.params, page: params.page, page_size: params.size }
    axiosOptions.params.organization = params.organization
    const result = (await axios.get(new URL('api/1/datasets/', catalogConfig.url).href, axiosOptions)).data
    datasets = result.data
    count = result.total
  } else {
    datasets = (await axios.get(new URL('api/1/me/org_datasets', catalogConfig.url).href, axiosOptions)).data
    datasets = datasets.filter((d: any) => !d.deleted)
    count = datasets.length
    if (params.size && params.page) {
      const startIndex = (params.page - 1) * params.size
      const endIndex = startIndex + Number(params.size)
      datasets = datasets.slice(startIndex, endIndex)
    }
  }

  // Convert datasets to folders
  const folders: Folder[] = datasets.map((dataset: any) => ({
    id: dataset.id,
    title: dataset.title,
    type: 'folder'
  }))

  return {
    count,
    results: folders,
    path: [] // Empty path for root level
  }
}

export const getResource = async ({ catalogConfig, secrets, importConfig, resourceId, tmpDir, log }: GetResourceContext<UDataConfig>): ReturnType<CatalogPlugin['getResource']> => {
  // Decode the composite ID (format: "datasetId:resourceId")
  const parts = resourceId.split(':')
  if (parts.length !== 2) {
    throw new Error(`Invalid resource ID format: ${resourceId}. Expected: "datasetId:resourceId"`)
  }
  const [datasetId, udataResourceId] = parts
  await log.step('Retrieving resource information')
  await log.info(`datasetId=${datasetId}, resourceId=${udataResourceId}`)

  // Axios configuration with API key if available
  const axiosOptions: Record<string, any> = { headers: {} }
  if (secrets.apiKey) axiosOptions.headers['X-API-KEY'] = secrets.apiKey

  // Get the dataset containing the resource
  const dataset = (await axios.get(
    new URL(`api/1/datasets/${datasetId}`, catalogConfig.url).href,
    axiosOptions
  )).data
  await log.info(`Dataset title: ${dataset.title}`)

  // Find the specific resource in the dataset
  const udataResource = dataset.resources?.find((r: any) => r.id === udataResourceId)
  if (!udataResource) {
    throw new Error(`Resource ${udataResourceId} not found in dataset ${datasetId}`)
  }
  await log.info(`Resource title: ${udataResource.title}`)

  if (!udataResource.url) { throw new Error(`Resource ${udataResourceId} has no download link`) }
  await log.info(`Download URL: ${udataResource.url}`)

  await log.step('Downloading the file')
  // Download the resource
  const fs = await import('node:fs')
  const path = await import('path')

  const response = await axios.get(udataResource.url, {
    responseType: 'stream'
  })

  // Determine the file extension from the URL or Content-Type
  const urlPath = new URL(udataResource.url).pathname
  let extension = path.extname(urlPath) || '.dat'
  if (!extension || extension === '.dat') {
    const contentType = response.headers['content-type']
    if (contentType?.includes('json')) extension = '.json'
    else if (contentType?.includes('csv')) extension = '.csv'
    else if (contentType?.includes('xml')) extension = '.xml'
    else if (contentType?.includes('excel')) extension = '.xlsx'
    else if (contentType?.includes('zip')) extension = '.zip'
  }
  await log.info(`File extension determined: ${extension}`)

  // Create a filename
  const resourceTitle = udataResource.title?.replace(/[^a-zA-Z0-9]/g, '_') || 'resource'
  const fileName = `${resourceTitle}${extension}`
  const filePath = path.join(tmpDir, fileName)
  await log.info(`Downloading resource to ${fileName}`)

  // Create write stream
  const writeStream = fs.createWriteStream(filePath)
  response.data.pipe(writeStream)

  // Return a promise that resolves with the file path
  await new Promise((resolve, reject) => {
    writeStream.on('finish', () => resolve(filePath))
    writeStream.on('error', (error) => reject(error))
  })
  await log.info(`Resource ${udataResource.title} downloaded successfully!`)

  await log.step('Preparing the dataset')

  const title = importConfig.useDatasetTitle ? dataset.title : udataResource.title
  const description = importConfig.useDatasetDescription ? dataset.description : udataResource.description
  await log.info(`Dataset title from ${importConfig.useDatasetTitle ? 'remote dataset' : 'remote resource'}: ${title}`)
  await log.info(`Dataset description from ${importConfig.useDatasetDescription ? 'remote dataset' : 'remote resource'}: ${description?.substring(0, 100)}${description?.length > 100 ? '...' : ''}`)

  const udataLicenses: { id: string, title: string, url: string }[] = (await axios.get(new URL('api/1/datasets/licenses', catalogConfig.url).href, axiosOptions)).data
  const udataLicense = udataLicenses.find((l: any) => l.id === udataResource.license)
  const license = udataLicense ? { title: udataLicense.title, href: udataLicense.url } : undefined
  if (license) await log.info(`License found: ${license.title}`)
  else await log.warning('No license specified for this resource')

  const resource: Resource = {
    id: resourceId,
    title: importConfig.useDatasetTitle ? dataset.title : udataResource.title,
    description: importConfig.useDatasetDescription ? dataset.description : udataResource.description,
    filePath,
    format: udataResource.format,
    frequency: udataResource.frequency,
    license,
    keywords: udataResource.tags,
    mimeType: udataResource.mime,
    origin: dataset.page,
    size: udataResource.filesize
  }
  return resource
}
