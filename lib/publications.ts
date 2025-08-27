import type { CatalogPlugin, Publication, ListDatasetsContext, PublishDatasetContext, DeleteDatasetContext } from '@data-fair/types-catalogs'
import type { UDataConfig } from '#types'

import axios from '@data-fair/lib-node/axios.js'
import { microTemplate } from '@data-fair/lib-utils/micro-template.js'

export const listDatasets = async ({ catalogConfig, secrets, params }: ListDatasetsContext<UDataConfig>): ReturnType<CatalogPlugin['listDatasets']> => {
  if (!secrets.apiKey) throw new Error('API key is required to list datasets')
  const axiosOptions: Record<string, any> = {
    headers: {
      'X-API-KEY': secrets.apiKey
    },
    params: {}
  }

  if (params.q) axiosOptions.params.q = params.q
  const udataDatasets = (await axios.get(new URL('api/1/me/org_datasets', catalogConfig.url).href, axiosOptions)).data
  const filteredDatasets = udataDatasets
    .filter((dataset: any) => params.mode === 'overwrite' || !dataset.deleted)
    .map((dataset: any) => ({
      id: dataset.id,
      title: dataset.deleted && params.mode === 'overwrite' ? `[Supprimé] ${dataset.title}` : dataset.title
    }))

  return {
    results: filteredDatasets
  }
}

export const publishDataset = async (context: PublishDatasetContext<UDataConfig>): ReturnType<CatalogPlugin['publishDataset']> => {
  if (!context.secrets.apiKey) throw new Error('API key is required to publish a dataset')
  if (context.publication.isResource) return addOrUpdateResource(context)
  else return await createOrUpdateDataset(context)
}

export const deleteDataset = async (context: DeleteDatasetContext<UDataConfig>): ReturnType<CatalogPlugin['deleteDataset']> => {
  if (!context.secrets.apiKey) throw new Error('API key is required to delete a dataset')
  if (context.resourceId) return await deleteUdataResource(context)
  else await deleteUdataDataset(context)
}

const createOrUpdateDataset = async ({ catalogConfig, secrets, dataset, publication, publicationSite, log }: PublishDatasetContext<UDataConfig>): Promise<Publication> => {
  await log.step('Preparing the dataset for publication/update on UData')
  const axiosOptions = { headers: { 'X-API-KEY': secrets.apiKey } }

  const datasetUrl = microTemplate(publicationSite.datasetUrlTemplate || '', { id: dataset.id, slug: dataset.slug })
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
      mime: 'text/html'
    })
    resources.push({
      title: 'Documentation de l\'API',
      description: 'Documentation interactive de l\'API à destination des développeurs. La description de l\'API utilise la spécification [OpenAPI 3.1.1](https://github.com/OAI/OpenAPI-Specification)',
      url: datasetUrl + '/api-doc',
      type: 'documentation',
      filetype: 'remote',
      format: 'Page Web',
      mime: 'text/html'
    })
  }

  if (dataset.file) {
    await log.info('Adding the main file')
    const originalFileFormat = dataset.originalFile.name.split('.').pop()
    resources.push({
      title: `Fichier ${originalFileFormat}`,
      description: `Téléchargez le fichier complet au format ${originalFileFormat}.`,
      url: `${publicationSite.url}/data-fair/api/v1/datasets/${dataset.id}/raw`,
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
        url: `${publicationSite.url}/data-fair/api/v1/datasets/${dataset.id}/convert`,
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
        url: `${publicationSite.url}/data-fair/api/v1/datasets/${dataset.id}/metadata-attachments/${attachment.name}`,
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
        url: `${publicationSite.url}/data-fair/api/v1/datasets/${dataset.id}/metadata-attachments/${attachment.name}`,
        filetype: 'remote',
        format: attachment.name.split('.').pop()
      })
    }
  }

  await log.step('Building the UData dataset')
  const udataDataset: Record<string, any> = {
    title: dataset.title,
    description: dataset.description || dataset.title, // Description field is required
    private: !dataset.public,
    resources
  }
  if (dataset.frequency) udataDataset.frequency = dataset.frequency
  if (dataset.temporal?.start) {
    udataDataset.temporal_coverage = {
      start: new Date(dataset.temporal.start).toISOString(),
      end: new Date(dataset.temporal.end ?? dataset.temporal.start).toISOString()
    }
  }
  if (dataset.keywords && dataset.keywords.length) udataDataset.tags = dataset.keywords
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
  if (publication.remoteDataset) {
    await log.step(`Updating existing remote dataset: ${publication.remoteDataset.id}`)
    const existingUdataDataset = (await axios.get(new URL('api/1/datasets/' + publication.remoteDataset.id, catalogConfig.url).href, axiosOptions)).data
    // If the dataset no longer exists, we create it
    if (!existingUdataDataset) {
      await log.warning(`The remote dataset ${publication.remoteDataset.id} no longer exists, creating a new dataset`)
      const res = await axios.post(new URL('api/1/datasets/', catalogConfig.url).href, udataDataset, axiosOptions)
      publication.remoteDataset = {
        id: res.data.id,
        title: res.data.title,
        url: res.data.page
      }
      await log.info(`New dataset created with ID: ${res.data.id}`)
      return publication
    } else if (existingUdataDataset.deleted) {
      await log.warning(`The remote dataset ${publication.remoteDataset.id} was deleted, creating a new dataset with the same id`)
      existingUdataDataset.deleted = null
    }

    // preserving resource id so that URLs are not broken
    if (existingUdataDataset.resources) {
      await log.info('Preserving existing resource identifiers')
      for (const resource of udataDataset.resources) {
        const matchingResource = existingUdataDataset.resources.find((r: { url?: string }) => resource.url === r.url)
        if (matchingResource) {
          resource.id = matchingResource.id
          await log.info(`Preserving identifier for resource: ${resource.title} (ID: ${resource.id})`)
        }
      }
    }

    Object.assign(existingUdataDataset, udataDataset)
    await log.info(`Updating remote dataset: ${publication.remoteDataset.id}`)
    await axios.put(new URL('api/1/datasets/' + publication.remoteDataset.id, catalogConfig.url).href, existingUdataDataset, axiosOptions)
    await log.info('Update successful')
  } else {
    await log.step('Creating a new dataset on UData')
    const res = await axios.post(new URL('api/1/datasets/', catalogConfig.url).href, udataDataset, axiosOptions)
    publication.remoteDataset = {
      id: res.data.id,
      title: res.data.title,
      url: res.data.page
    }
    await log.info(`New dataset created with ID: ${res.data.id}`)
  }

  await log.info('Publication completed successfully')
  return publication
}

const deleteUdataDataset = async ({ catalogConfig, secrets, datasetId, log }: DeleteDatasetContext<UDataConfig>): Promise<void> => {
  try {
    await log.step(`Deleting dataset ${datasetId}`)
    await axios.delete(new URL(`api/1/datasets/${datasetId}/`, catalogConfig.url).href, { headers: { 'X-API-KEY': secrets.apiKey } })
    await log.info(`Dataset ${datasetId} deleted successfully`)
  } catch (e: any) {
    await log.error(`Error deleting dataset: ${e.message}`)
    if (![404, 410].includes(e.status)) throw new Error(`Error deleting dataset on ${catalogConfig.url}: ${e.message}`)
    await log.warning(`Dataset ${datasetId} does not exist or has already been deleted (code ${e.status})`)
  }
}

const addOrUpdateResource = async ({ catalogConfig, secrets, dataset, publication, publicationSite, log }: PublishDatasetContext<UDataConfig>): Promise<Publication> => {
  await log.step('Preparing the resource for publication on UData')

  const axiosOptions = { headers: { 'X-API-KEY': secrets.apiKey } }
  if (!publication.remoteDataset) throw new Error('No remote dataset associated with this publication')

  await log.info(`Retrieving remote dataset ${publication.remoteDataset.id}`)
  const udataDataset = (await axios.get(new URL('api/1/datasets/' + publication.remoteDataset.id, catalogConfig.url).href, axiosOptions)).data
  if (!udataDataset) throw new Error('Remote dataset not found')
  if (udataDataset.deleted) throw new Error('Remote dataset deleted')

  await log.info(`Building resource for dataset ${dataset.title}`)
  const existingUdataResource = udataDataset.resources.find((r: { id: string }) => r.id === publication.remoteResource?.id)
  const title = `${dataset.title} - Consultez les données`
  const description = `Consultez directement les données dans ${dataset.bbox ? 'une carte interactive' : 'un tableau'}.`
  const url = microTemplate(publicationSite.datasetUrlTemplate || '', { id: dataset.id, slug: dataset.slug })

  if (publication.remoteResource && existingUdataResource) { // Update it
    await log.step(`Updating existing resource ${publication.remoteResource.id}`)
    existingUdataResource.title = title
    existingUdataResource.description = description
    existingUdataResource.url = url
    await axios.put(new URL('api/1/datasets/' + publication.remoteDataset.id + '/resources/' + publication.remoteResource.id, catalogConfig.url).href, existingUdataResource, axiosOptions)
    await log.info(`Resource ${publication.remoteResource.id} updated successfully`)
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

    await log.info(`Adding resource to dataset ${publication.remoteDataset.title || publication.remoteDataset.id}`)
    const res = await axios.post(new URL('api/1/datasets/' + publication.remoteDataset.id + '/resources/', catalogConfig.url).href, resource, axiosOptions)
    publication.remoteResource = {
      id: res.data.id,
      title: res.data.title
    }
    await log.info(`Resource created with ID: ${res.data.id}`)
    publication.remoteDataset.url = udataDataset.page
  }

  await log.info('Resource publication completed successfully')
  return publication
}

const deleteUdataResource = async ({ catalogConfig, secrets, datasetId, resourceId, log }: DeleteDatasetContext<UDataConfig>): Promise<void> => {
  try {
    await log.step(`Deleting resource ${resourceId} from dataset ${datasetId}`)
    await axios.delete(new URL(`api/1/datasets/${datasetId}/resources/${resourceId}`, catalogConfig.url).href, { headers: { 'X-API-KEY': secrets.apiKey } })
    await log.info(`Resource ${resourceId} deleted successfully`)
  } catch (e: any) {
    await log.error(`Error deleting resource: ${e.message}`)
    if (![404, 410].includes(e.status)) throw new Error(`Error deleting resource on ${catalogConfig.url}: ${e.message}`)
    await log.warning(`Resource ${resourceId} doesn't exist or has already been deleted (code ${e.status})`)
  }
}
