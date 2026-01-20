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
  await log.step('Preparing the dataset for publication/update on UData')
  const axiosOptions = { headers: { 'X-API-KEY': secrets.apiKey } }

  const datasetUrl = microTemplate(publicationSite.datasetUrlTemplate || '', { id: dataset.id, slug: dataset.slug })
  const useSlug = !!(publicationSite.datasetUrlTemplate && publicationSite.datasetUrlTemplate.includes('slug'))
  await log.info(`Dataset access URL: ${datasetUrl}`)

  await log.info('Preparing resources to publish')
  const resources = []
  if (dataset.isMetaOnly) {
    await log.info('Metadata-only dataset')
    resources.push({
      title: 'Consultez les données',
      description: 'Consultez le jeu de données',
      url: datasetUrl,
      type: 'main',
      filetype: 'remote',
      format: 'Page Web',
      mime: 'text/html'
    })
  } else {
    await log.info('Dataset with content')
    resources.push({
      title: 'Consultez les données',
      description: `Consultez directement les données dans ${dataset.bbox ? 'une carte interactive' : 'un tableau'}.`,
      url: datasetUrl,
      type: 'main',
      filetype: 'remote',
      format: 'Page Web',
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
      format: 'Page Web',
      mime: 'text/html',
      extras: {
        datafairEmbed: 'fields'
      }
    })
    resources.push({
      title: 'Documentation de l\'API',
      description: 'Documentation interactive de l\'API à destination des développeurs. La description de l\'API utilise la spécification [OpenAPI 3.1.1](https://github.com/OAI/OpenAPI-Specification)',
      url: datasetUrl + '/api-doc',
      type: 'documentation',
      filetype: 'remote',
      format: 'Page Web',
      mime: 'text/html',
      extras: {
        apidocUrl: `${publicationSite.url}/data-fair/api/v1/datasets/${useSlug ? dataset.slug : dataset.id}/api-docs.json`
      }
    })
  }

  if (dataset.file) {
    await log.info('Adding the main file')
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
      await log.info(`Adding file in ${fileFormat} format`)
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

  await log.info('Preparing attachments')
  for (const attachment of dataset.attachments || []) {
    if (!attachment.includeInCatalogPublications) continue
    if (attachment.type === 'url') {
      await log.info(`Adding URL attachment: ${attachment.title}`)
      resources.push({
        title: attachment.title,
        description: attachment.description,
        url: attachment.url
      })
    }
    if (attachment.type === 'file') {
      await log.info(`Adding file attachment: ${attachment.title}`)
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
      await log.info(`Adding remote file attachment: ${attachment.title}`)
      resources.push({
        title: attachment.title,
        description: attachment.description,
        url: `${publicationSite.url}/data-fair/api/v1/datasets/${useSlug ? dataset.slug : dataset.id}/metadata-attachments/${attachment.name}`,
        filetype: 'remote',
        format: attachment.name.split('.').pop()
      })
    }
  }

  await log.step('Building the UData dataset')
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
    await log.step('Mapping spatial coverage')
    const spatial = await mapSpatialCoverage(dataset.spatial, catalogConfig.url, axiosOptions, log)
    if (spatial.zones.length > 0) {
      udataDataset.spatial = spatial
      await log.info(`Spatial coverage mapped with ${spatial.zones.length} zone(s)`)
    }
  }
  if (dataset.license) {
    await log.info(`Searching for corresponding license: ${dataset.license.href}`)
    const udataLicenses = (await axios.get<any[]>(new URL('api/1/datasets/licenses/', catalogConfig.url).href, axiosOptions)).data
    const udataLicense = udataLicenses.find(l => l.url === dataset.license.href)
    if (udataLicense) {
      await log.info(`License found: ${udataLicense.title}`)
      udataDataset.license = udataLicense.id
    } else {
      await log.warning(`License not found on UData: ${dataset.license.href}`)
    }
  }
  if (catalogConfig.organization?.id) {
    await log.info(`Associating with organization: ${catalogConfig.organization.id}`)
    udataDataset.organization = { id: catalogConfig.organization.id }
  }

  // Try to retrieve the remote dataset to update it
  if (publication.remoteFolder) {
    await log.step(`Updating existing remote dataset: ${publication.remoteFolder.id}`)
    const existingUdataDataset = (await axios.get(new URL('api/1/datasets/' + publication.remoteFolder.id, catalogConfig.url).href, axiosOptions)).data
    // If the dataset no longer exists, we create it
    if (!existingUdataDataset) {
      // await log.warning(`The remote dataset ${publication.remoteFolder.id} no longer exists, creating a new dataset`)
      // const res = await axios.post(new URL('api/1/datasets/', catalogConfig.url).href, udataDataset, axiosOptions)
      // publication.remoteFolder = {
      //   id: res.data.id,
      //   title: res.data.title,
      //   url: res.data.page
      // }
      // await log.info(`New dataset created with ID: ${res.data.id}`)
      // return publication
      throw new Error(`The remote dataset ${publication.remoteFolder.id} no longer exists.`)
    } else if (existingUdataDataset.deleted) {
      await log.warning(`The remote dataset ${publication.remoteFolder.id} was deleted, creating a new dataset with the same id`)
      existingUdataDataset.deleted = null
    }

    // preserving resource id so that URLs are not broken
    if (existingUdataDataset.resources) {
      await log.info('Preserving existing resource identifiers')
      for (const resource of udataDataset.resources) {
        const matchingResource = existingUdataDataset.resources.find((r: { url?: string, title?: string, extras?: any }) => {
          if (!r.url || !resource.url) return false

          // Special case: for URLs ending with /convert or /raw, match only by suffix
          if (resource.url.endsWith('/convert')) return r.url.endsWith('/convert')
          if (resource.url.endsWith('/raw')) return r.url.endsWith('/raw')
          // For URLs that are identical, we need to differentiate by title and extras
          if (resource.url === r.url) {
            // Match by title first
            if (r.title !== resource.title) return false
            // If both have extras.datafairEmbed, they must match
            if (resource.extras?.datafairEmbed && r.extras?.datafairEmbed) {
              return resource.extras.datafairEmbed === r.extras.datafairEmbed
            }
            return true
          }

          return false
        })
        if (matchingResource) {
          resource.id = matchingResource.id
          await log.info(`Preserving identifier for resource: ${resource.title} (ID: ${resource.id})`)
          // If the existing resource has a harvest, clear it
          if (matchingResource.harvest) {
            resource.harvest = {}
            await log.info(`Clear harvest for resource: ${resource.title}`)
          }
        }
      }
    }

    // If the existing dataset has a harvest, set it with new remote_url
    if (existingUdataDataset.harvest) {
      udataDataset.harvest = { remote_url: datasetUrl }
      await log.info(`Setting harvest with remote_url for dataset: ${datasetUrl}`)
    }

    Object.assign(existingUdataDataset, udataDataset)
    await log.info(`Updating remote dataset: ${publication.remoteFolder.id}`)
    const res = await axios.put(new URL('api/1/datasets/' + publication.remoteFolder.id, catalogConfig.url).href, existingUdataDataset, axiosOptions)
    publication.remoteFolder = {
      id: res.data.id,
      title: res.data.title,
      url: res.data.page
    }
    await log.info('Update successful')
  } else {
    await log.step('Creating a new dataset on UData')
    const res = await axios.post(new URL('api/1/datasets/', catalogConfig.url).href, udataDataset, axiosOptions)
    publication.remoteFolder = {
      id: res.data.id,
      title: res.data.title,
      url: res.data.page
    }
    await log.info(`New dataset created with ID: ${res.data.id}`)
  }

  await log.info('Publication completed successfully')
  return publication
}

const deleteDataset = async ({ catalogConfig, secrets, folderId, log }: DeletePublicationContext<UDataConfig>): Promise<void> => {
  try {
    await log.step(`Deleting dataset ${folderId}`)
    await axios.delete(new URL(`api/1/datasets/${folderId}/`, catalogConfig.url).href, { headers: { 'X-API-KEY': secrets.apiKey } })
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
      format: 'Page Web',
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

const normalizeString = (str: string): string => str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const mapSpatialCoverage = async (spatial: string, catalogUrl: string, axiosOptions: any, log: any): Promise<{ granularity?: string, zones: string[] }> => {
  // Split spatial value by semicolon and process each zone
  const spatialValues = spatial.split(';').map(s => s.trim()).filter(s => s.length > 0)

  // Fetch all spatial zones in parallel
  const searchPromises = spatialValues.map(async (spatialValue) => {
    try {
      await log.info(`Searching for spatial zone: ${spatialValue}`)
      const suggestUrl = new URL('api/1/spatial/zones/suggest/', catalogUrl)
      suggestUrl.searchParams.set('q', spatialValue)
      suggestUrl.searchParams.set('size', '10')

      const response = await axios.get<{ id: string, level: string, name: string }[]>(suggestUrl.href, axiosOptions)
      const results = response.data

      if (results && results.length > 0) {
        // Try to find an exact match on the name field (normalized)
        const normalizedQuery = normalizeString(spatialValue)
        const exactMatch = results.find(r => normalizeString(r.name) === normalizedQuery)

        const selectedResult = exactMatch || results[0]
        await log.info(`Found spatial zone: ${selectedResult.name} (${selectedResult.id})${exactMatch ? ' [exact match]' : ''}`)
        return { id: selectedResult.id, level: selectedResult.level }
      } else {
        await log.warning(`No spatial zone found for: ${spatialValue}`)
        return null
      }
    } catch (error: any) {
      await log.warning(`Error searching for spatial zone "${spatialValue}": ${error.message}`)
      return null
    }
  })

  const searchResults = await Promise.all(searchPromises)
  const validResults = searchResults.filter((r): r is { id: string, level: string } => r !== null)

  const zones: string[] = []
  const levels: string[] = []
  for (const result of validResults) {
    zones.push(result.id)
    levels.push(result.level)
  }

  const result: { granularity?: string, zones: string[] } = { zones }

  // Set granularity if all levels are the same
  if (levels.length > 0 && levels.every(level => level === levels[0])) {
    result.granularity = levels[0]
    await log.info(`Granularity set to: ${levels[0]}`)
  }

  return result
}
