import type { CatalogPlugin, Publication, PublishDatasetContext, DeletePublicationContext } from '@data-fair/types-catalogs'
import type { UDataConfig } from '#types'

import axios from '@data-fair/lib-node/axios.js'
import { microTemplate } from '@data-fair/lib-utils/micro-template.js'

export const publishDataset = async (context: PublishDatasetContext<UDataConfig>): ReturnType<CatalogPlugin['publishDataset']> => {
  if (!context.secrets.apiKey) throw new Error('API key is required to publish a dataset')
  if (['createResource', 'replaceResource'].includes(context.publication.action)) return createOrUpdateResource(context)
  else return await createOrUpdateDataset(context)
}

export const deletePublication = async (context: DeletePublicationContext<UDataConfig>): ReturnType<CatalogPlugin['deletePublication']> => {
  if (!context.secrets.apiKey) throw new Error('API key is required to delete a publication')
  if (context.resourceId) return await deleteResource(context)
  else await deleteDataset(context)
}

const createOrUpdateDataset = async ({ catalogConfig, secrets, dataset, publication, publicationSite, log }: PublishDatasetContext<UDataConfig>): Promise<Publication> => {
  const axiosOptions = { headers: { 'X-API-KEY': secrets.apiKey } }
  const datasetUrl = microTemplate(publicationSite.datasetUrlTemplate || '', { id: dataset.id, slug: dataset.slug })
  const useSlug = !!(publicationSite.datasetUrlTemplate && publicationSite.datasetUrlTemplate.includes('slug'))
  const isUpdate = !!publication.remoteFolder

  // Step 1: Prepare resources and attachments
  await log.step('Preparing resources')
  await log.info(`Dataset access URL: ${datasetUrl}`)

  const resources = []
  if (dataset.isMetaOnly) {
    resources.push({
      title: 'Consultez les données',
      description: 'Consultez le jeu de données',
      url: datasetUrl,
      type: 'main',
      filetype: 'remote',
      format: 'url',
      mime: 'text/html'
    })
  } else {
    resources.push({
      title: 'Consultez les données',
      description: `Consultez directement les données dans ${dataset.bbox ? 'une carte interactive' : 'un tableau'}.`,
      url: datasetUrl,
      type: 'main',
      filetype: 'remote',
      format: 'url',
      mime: 'text/html',
      extras: {
        datafairEmbed: dataset.bbox ? 'map' : 'table'
      }
    })
    resources.push({
      title: 'Description des champs',
      description: 'Description détaillée et types sémantiques des champs',
      url: datasetUrl,
      type: 'documentation',
      filetype: 'remote',
      format: 'url',
      mime: 'text/html',
      extras: {
        datafairEmbed: 'fields'
      }
    })
  }

  if (dataset.file) {
    const originalFileFormat = dataset.originalFile.name.split('.').pop()
    resources.push({
      title: `Fichier ${originalFileFormat}`,
      description: `Téléchargez le fichier complet au format ${originalFileFormat}.`,
      url: `${publicationSite.url}/data-fair/api/v1/datasets/${useSlug ? dataset.slug : dataset.id}/raw`,
      type: 'main',
      filetype: 'remote',
      filesize: dataset.originalFile.size,
      mime: dataset.originalFile.mimetype,
      format: originalFileFormat
    })
    if (dataset.file.mimetype !== dataset.originalFile.mimetype) {
      const fileFormat = dataset.file.name.split('.').pop()
      resources.push({
        title: `Fichier ${fileFormat}`,
        description: `Téléchargez le fichier complet au format ${fileFormat}.`,
        url: `${publicationSite.url}/data-fair/api/v1/datasets/${useSlug ? dataset.slug : dataset.id}/convert`,
        type: 'main',
        filetype: 'remote',
        filesize: dataset.file.size,
        mime: dataset.file.mimetype,
        format: fileFormat
      })
    }
  }

  let attachmentCount = 0
  for (const attachment of dataset.attachments || []) {
    if (!attachment.includeInCatalogPublications) continue
    attachmentCount++
    if (attachment.type === 'url') {
      resources.push({
        title: attachment.title,
        description: attachment.description,
        url: attachment.url,
        format: 'url'
      })
    }
    if (attachment.type === 'file') {
      resources.push({
        title: attachment.title,
        description: attachment.description,
        url: `${publicationSite.url}/data-fair/api/v1/datasets/${useSlug ? dataset.slug : dataset.id}/metadata-attachments/${attachment.name}`,
        filetype: 'remote',
        filesize: attachment.size,
        mime: attachment.mimetype,
        format: attachment.name.split('.').pop()
      })
    }
    if (attachment.type === 'remoteFile') {
      resources.push({
        title: attachment.title,
        description: attachment.description,
        url: `${publicationSite.url}/data-fair/api/v1/datasets/${useSlug ? dataset.slug : dataset.id}/metadata-attachments/${attachment.name}`,
        filetype: 'remote',
        format: attachment.name.split('.').pop()
      })
    }
  }

  const resourceCount = resources.length - attachmentCount
  await log.info(`${resourceCount} resource(s) and ${attachmentCount} attachment(s) ready to publish`)

  // Step 2: Build UData dataset payload
  await log.step('Building UData dataset')
  const udataDataset: Record<string, any> = {
    title: dataset.title,
    description: dataset.description || dataset.title, // Description field is required
    description_short: dataset.summary && dataset.summary.length > 200
      ? dataset.summary.substring(0, 197) + '...'
      : dataset.summary,
    private: !dataset.public,
    resources,
    extras: {
      datafairOrigin: publicationSite.url + '/data-fair',
      datafairDatasetId: dataset.id
    }
  }
  if (dataset.frequency) udataDataset.frequency = dataset.frequency
  if (dataset.temporal?.start) {
    udataDataset.temporal_coverage = {
      start: new Date(dataset.temporal.start).toISOString(),
      end: new Date(dataset.temporal.end ?? dataset.temporal.start).toISOString()
    }
  }
  if (dataset.keywords && dataset.keywords.length) udataDataset.tags = dataset.keywords
  if (dataset.spatial) {
    const spatial = await mapSpatialCoverage(dataset.spatial, catalogConfig.url, axiosOptions, log)
    if (spatial.zones.length > 0) {
      udataDataset.spatial = spatial
      await log.info(`Spatial coverage: ${spatial.zones.length} zone(s) mapped`)
    }
  }
  if (dataset.license) {
    const udataLicenses = (await axios.get<any[]>(new URL('api/1/datasets/licenses/', catalogConfig.url).href, axiosOptions)).data
    const udataLicense = udataLicenses.find(l => l.url === dataset.license.href)
    if (udataLicense) {
      await log.info(`License: ${udataLicense.title}`)
      udataDataset.license = udataLicense.id
    } else {
      await log.warning(`License not found on UData: ${dataset.license.href}`)
    }
  }
  if (catalogConfig.organization?.id) {
    udataDataset.organization = { id: catalogConfig.organization.id }
  }

  const metadataDetails = [
    dataset.frequency ? `frequency=${dataset.frequency}` : null,
    dataset.temporal?.start ? 'temporal coverage' : null,
    dataset.keywords?.length ? `${dataset.keywords.length} tag(s)` : null,
    catalogConfig.organization?.id ? `organization=${catalogConfig.organization.id}` : null,
    !dataset.public ? 'private' : 'public'
  ].filter(Boolean).join(', ')
  await log.info(`Dataset metadata: ${metadataDetails}`)

  // Step 3: Create or update remote dataset
  if (isUpdate) {
    await log.step(`Updating remote dataset: ${publication.remoteFolder!.id}`)
    const existingUdataDataset = (await axios.get(new URL('api/1/datasets/' + publication.remoteFolder!.id, catalogConfig.url).href, axiosOptions)).data
    if (!existingUdataDataset) {
      throw new Error(`The remote dataset ${publication.remoteFolder!.id} no longer exists.`)
    } else if (existingUdataDataset.deleted) {
      await log.warning('Dataset was deleted on UData, restoring with the same ID')
      existingUdataDataset.deleted = null
    }

    // Preserve resource IDs so that URLs are not broken
    let preservedCount = 0
    if (existingUdataDataset.resources) {
      for (const resource of udataDataset.resources) {
        const matchingResource = existingUdataDataset.resources.find((r: { url?: string, title?: string, extras?: any }) => {
          if (!r.url || !resource.url) return false
          if (resource.url.endsWith('/convert')) return r.url.endsWith('/convert')
          if (resource.url.endsWith('/raw')) return r.url.endsWith('/raw')
          if (resource.url === r.url) {
            if (r.title !== resource.title) return false
            if (resource.extras?.datafairEmbed && r.extras?.datafairEmbed) {
              return resource.extras.datafairEmbed === r.extras.datafairEmbed
            }
            return true
          }
          return false
        })
        if (matchingResource) {
          resource.id = matchingResource.id
          preservedCount++
          if (matchingResource.harvest) {
            resource.harvest = {}
          }
        }
      }
    }
    if (preservedCount > 0) {
      await log.info(`${preservedCount} existing resource identifier(s) preserved`)
    }

    if (existingUdataDataset.harvest) {
      udataDataset.harvest = { remote_url: datasetUrl }
    }

    // Read dataserviceId before Object.assign overwrites extras
    const existingDataserviceId = existingUdataDataset.extras?.dataserviceId
    if (existingDataserviceId) {
      udataDataset.extras.dataserviceId = existingDataserviceId
    }

    Object.assign(existingUdataDataset, udataDataset)
    const res = await axios.put(new URL('api/1/datasets/' + publication.remoteFolder!.id, catalogConfig.url).href, existingUdataDataset, axiosOptions)
    publication.remoteFolder = {
      id: res.data.id,
      title: res.data.title,
      url: res.data.page
    }
    await log.info('Remote dataset updated successfully')

    // Step 4: Manage linked dataservice
    if (!dataset.isMetaOnly) {
      await log.step(existingDataserviceId ? `Updating linked dataservice: ${existingDataserviceId}` : 'Creating linked dataservice')
      await createOrUpdateDataservice({
        datasetRemoteId: publication.remoteFolder.id,
        dataserviceId: existingDataserviceId,
        dataset,
        publicationSite,
        datasetUrl,
        useSlug,
        catalogConfig,
        existingExtras: res.data.extras || {},
        axiosOptions,
        log
      })
    }
  } else {
    await log.step('Creating new dataset on UData')
    const res = await axios.post(new URL('api/1/datasets/', catalogConfig.url).href, udataDataset, axiosOptions)
    publication.remoteFolder = {
      id: res.data.id,
      title: res.data.title,
      url: res.data.page
    }
    await log.info(`Dataset created: ${res.data.id}`)

    // Step 4: Create linked dataservice
    if (!dataset.isMetaOnly) {
      await log.step('Creating linked dataservice')
      await createOrUpdateDataservice({
        datasetRemoteId: publication.remoteFolder.id,
        dataserviceId: undefined,
        dataset,
        publicationSite,
        datasetUrl,
        useSlug,
        catalogConfig,
        existingExtras: res.data.extras || {},
        axiosOptions,
        log
      })
    }
  }

  // Step 5: Final summary
  await log.step('Publication complete')
  await log.info(`Dataset "${dataset.title}" published to ${catalogConfig.url}`)
  await log.info(`Remote ID: ${publication.remoteFolder!.id} — ${resources.length} resource(s) total`)
  return publication
}

const deleteDataservice = async (catalogUrl: string, dataserviceId: string, axiosOptions: { headers: Record<string, string> }, log: any): Promise<void> => {
  try {
    await log.info(`Deleting dataservice ${dataserviceId}`)
    await axios.delete(new URL(`api/1/dataservices/${dataserviceId}/`, catalogUrl).href, axiosOptions)
    await log.info(`Dataservice ${dataserviceId} deleted`)
  } catch (e: any) {
    if ([404, 410].includes(e.status)) {
      await log.warning(`Dataservice ${dataserviceId} already deleted (${e.status})`)
    } else {
      await log.warning(`Failed to delete dataservice ${dataserviceId}: ${e.message}`)
    }
  }
}

const deleteDataset = async ({ catalogConfig, secrets, folderId, log }: DeletePublicationContext<UDataConfig>): Promise<void> => {
  const axiosOptions = { headers: { 'X-API-KEY': secrets.apiKey } }

  // Try to read the dataset to get the linked dataserviceId
  try {
    const remoteDataset = (await axios.get(new URL(`api/1/datasets/${folderId}/`, catalogConfig.url).href, axiosOptions)).data
    if (remoteDataset?.extras?.dataserviceId) {
      await deleteDataservice(catalogConfig.url, remoteDataset.extras.dataserviceId, axiosOptions, log)
    }
  } catch (e: any) {
    if (![404, 410].includes(e.status)) {
      await log.warning(`Could not read dataset ${folderId} to find dataservice: ${e.message}`)
    }
  }

  try {
    await log.step(`Deleting dataset ${folderId}`)
    await axios.delete(new URL(`api/1/datasets/${folderId}/`, catalogConfig.url).href, axiosOptions)
    await log.info(`Dataset ${folderId} deleted successfully`)
  } catch (e: any) {
    await log.error(`Error deleting dataset: ${e.message}`)
    if (![404, 410].includes(e.status)) throw new Error(`Error deleting dataset on ${catalogConfig.url}: ${e.message}`)
    await log.warning(`Dataset ${folderId} does not exist or has already been deleted (code ${e.status})`)
  }
}

const createOrUpdateResource = async ({ catalogConfig, secrets, dataset, publication, publicationSite, log }: PublishDatasetContext<UDataConfig>): Promise<Publication> => {
  await log.step('Preparing the resource for publication on UData')

  const axiosOptions = { headers: { 'X-API-KEY': secrets.apiKey } }

  let datasetId: string | undefined
  let resourceId: string | undefined

  if (publication.remoteFolder) datasetId = publication.remoteFolder.id
  if (publication.remoteResource?.id) {
    const parts = publication.remoteResource.id.split(':')
    if (parts.length !== 2) {
      throw new Error(`Invalid resource ID: ${publication.remoteResource.id}. Expected: "datasetId:resourceId"`)
    }
    datasetId = parts[0]
    resourceId = parts[1]
  }
  if (!datasetId) throw new Error('Dataset ID is required to create or update a resource')

  await log.info(`Retrieving remote dataset ${datasetId}`)
  const udataDataset = (await axios.get(new URL('api/1/datasets/' + datasetId, catalogConfig.url).href, axiosOptions)).data
  if (!udataDataset) throw new Error('Remote dataset not found')
  if (udataDataset.deleted) throw new Error('Remote dataset deleted')

  await log.info(`Building resource for dataset ${dataset.title}`)
  const title = `${dataset.title} - Consultez les données`
  const description = `Consultez directement les données dans ${dataset.bbox ? 'une carte interactive' : 'un tableau'}.`
  const url = microTemplate(publicationSite.datasetUrlTemplate || '', { id: dataset.id, slug: dataset.slug })

  const existingUdataResource = udataDataset.resources.find((r: { id: string }) => r.id === resourceId)
  if (resourceId && existingUdataResource) { // Update it
    await log.step(`Updating existing resource ${resourceId}`)
    existingUdataResource.title = title
    existingUdataResource.description = description
    existingUdataResource.url = url
    const res = await axios.put(new URL('api/1/datasets/' + datasetId + '/resources/' + resourceId, catalogConfig.url).href, existingUdataResource, axiosOptions)

    publication.remoteResource = {
      id: `${datasetId}:${existingUdataResource.id}`,
      title: res.data.title,
      url: udataDataset.page
    }
    await log.info(`Resource ${resourceId} updated successfully`)
  } else { // Add it
    await log.step('Creating a new resource')
    const resource = {
      title,
      description,
      url,
      type: 'main',
      filetype: 'remote',
      format: 'url',
      mime: 'text/html'
    }

    await log.info(`Adding resource to dataset ${udataDataset.title || datasetId}`)
    const res = await axios.post(new URL('api/1/datasets/' + datasetId + '/resources/', catalogConfig.url).href, resource, axiosOptions)

    publication.remoteResource = {
      id: `${datasetId}:${res.data.id}`,
      title: res.data.title,
      url: udataDataset.page
    }
    await log.info(`Resource created with ID: ${res.data.id} in dataset ${datasetId}`)
  }

  await log.info('Resource publication completed successfully')
  return publication
}

const deleteResource = async ({ catalogConfig, secrets, folderId, resourceId, log }: DeletePublicationContext<UDataConfig>): Promise<void> => {
  try {
    if (!resourceId) {
      throw new Error('Resource ID is required for deletion')
    }

    let datasetId: string
    let actualResourceId: string

    if (folderId) {
      // Mode classique avec folderId et resourceId séparés
      datasetId = folderId
      actualResourceId = resourceId
    } else {
      // Mode avec ID composite (format: "datasetId:resourceId")
      const parts = resourceId.split(':')
      if (parts.length !== 2) {
        throw new Error(`Invalid resource ID format: ${resourceId}. Expected: "datasetId:resourceId" when folderId is not provided`)
      }
      datasetId = parts[0]
      actualResourceId = parts[1]
    }

    await log.step(`Deleting resource ${actualResourceId} from dataset ${datasetId}`)
    await axios.delete(new URL(`api/1/datasets/${datasetId}/resources/${actualResourceId}`, catalogConfig.url).href, { headers: { 'X-API-KEY': secrets.apiKey } })
    await log.info(`Resource ${actualResourceId} deleted successfully`)
  } catch (e: any) {
    await log.error(`Error deleting resource: ${e.message}`)
    if (![404, 410].includes(e.status)) throw new Error(`Error deleting resource on ${catalogConfig.url}: ${e.message}`)
    await log.warning(`Resource ${resourceId} doesn't exist or has already been deleted (code ${e.status})`)
  }
}

interface DataserviceOptions {
  datasetRemoteId: string
  dataserviceId: string | undefined
  dataset: Record<string, any>
  publicationSite: { url: string, datasetUrlTemplate?: string }
  datasetUrl: string
  useSlug: boolean
  catalogConfig: { url: string, organization?: { id: string } }
  existingExtras: Record<string, any>
  axiosOptions: { headers: Record<string, string> }
  log: any
}

const createOrUpdateDataservice = async (opts: DataserviceOptions): Promise<string | undefined> => {
  const { datasetRemoteId, dataserviceId, dataset, publicationSite, datasetUrl, useSlug, catalogConfig, existingExtras, axiosOptions, log } = opts
  const datasetRef = useSlug ? dataset.slug : dataset.id

  const dataserviceData: Record<string, any> = {
    title: dataset.title,
    description: dataset.description || dataset.title,
    base_api_url: `${publicationSite.url}/data-fair/api/v1/datasets/${datasetRef}/`,
    technical_documentation_url: `${datasetUrl}/api-doc`,
    machine_documentation_url: `${publicationSite.url}/data-fair/api/v1/datasets/${datasetRef}/api-docs.json`,
    format: 'REST',
    private: !dataset.public,
    datasets: [datasetRemoteId],
    availability: 99.9
  }
  if (catalogConfig.organization?.id) {
    dataserviceData.organization = catalogConfig.organization.id
  }

  // Update existing dataservice
  if (dataserviceId) {
    try {
      await axios.patch(new URL(`api/1/dataservices/${dataserviceId}/`, catalogConfig.url).href, dataserviceData, axiosOptions)
      await log.info('Dataservice updated successfully')
      return dataserviceId
    } catch (e: any) {
      if ([404, 410].includes(e.status)) {
        await log.warning(`Dataservice ${dataserviceId} no longer exists, creating a new one`)
      } else {
        await log.warning(`Failed to update dataservice: ${e.message}`)
        return undefined
      }
    }
  }

  // Create new dataservice
  try {
    const res = await axios.post(new URL('api/1/dataservices/', catalogConfig.url).href, dataserviceData, axiosOptions)
    const newId = res.data.id
    await log.info(`Dataservice created: ${newId}`)

    // Write dataserviceId back to the remote dataset extras
    await axios.put(
      new URL(`api/1/datasets/${datasetRemoteId}/`, catalogConfig.url).href,
      { extras: { ...existingExtras, dataserviceId: newId } },
      axiosOptions
    )
    await log.info('Dataservice ID stored in dataset extras')
    return newId
  } catch (e: any) {
    await log.warning(`Failed to create dataservice: ${e.message}`)
    return undefined
  }
}

const normalizeString = (str: string): string => str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const mapSpatialCoverage = async (spatial: string, catalogUrl: string, axiosOptions: any, log: any): Promise<{ granularity?: string, zones: string[] }> => {
  // Split spatial value by semicolon and process each zone
  const spatialValues = spatial.split(';').map(s => s.trim()).filter(s => s.length > 0)

  // Fetch all spatial zones in parallel
  const searchPromises = spatialValues.map(async (spatialValue) => {
    try {
      const suggestUrl = new URL('api/1/spatial/zones/suggest/', catalogUrl)
      suggestUrl.searchParams.set('q', spatialValue)
      suggestUrl.searchParams.set('size', '10')

      const response = await axios.get<{ id: string, level: string, name: string }[]>(suggestUrl.href, axiosOptions)
      const results = response.data

      if (results && results.length > 0) {
        const normalizedQuery = normalizeString(spatialValue)
        const exactMatch = results.find(r => normalizeString(r.name) === normalizedQuery)
        if (!exactMatch) return null
        return { id: exactMatch.id, level: exactMatch.level, name: exactMatch.name }
      }
      return null
    } catch (error: any) {
      await log.warning(`Error searching for spatial zone "${spatialValue}": ${error.message}`)
      return null
    }
  })

  const searchResults = await Promise.all(searchPromises)
  const validResults = searchResults.filter((r): r is { id: string, level: string, name: string } => r !== null)
  const notFound = spatialValues.filter((_, i) => searchResults[i] === null)

  const zones: string[] = []
  const levels: string[] = []
  for (const result of validResults) {
    zones.push(result.id)
    levels.push(result.level)
  }

  if (notFound.length > 0) {
    await log.warning(`Spatial zone(s) not found: ${notFound.join(', ')}`)
  }

  const result: { granularity?: string, zones: string[] } = { zones }

  if (levels.length > 0 && levels.every(level => level === levels[0])) {
    result.granularity = levels[0]
  }

  return result
}
