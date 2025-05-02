import type { CatalogDataset, CatalogResourceDataset, Publication } from '@data-fair/lib-common-types/catalog/index.js'
import type { UDataConfig, License } from '#types'

import axios from '@data-fair/lib-node/axios.js'
import { httpError } from '@data-fair/lib-utils/http-errors.js'

export const prepareDatasetFromCatalog = (catalogConfig: UDataConfig, udataDataset: any) => {
  const dataset: CatalogDataset = {
    id: udataDataset.id,
    title: udataDataset.title,
    description: udataDataset.description,
    keywords: udataDataset.tags,
    origin: udataDataset.uri,
    private: udataDataset.private,
    resources: udataDataset.resources.map((udataResource: any) => {
      const resource: CatalogResourceDataset = {
        id: udataResource.id,
        title: udataResource.title,
        format: udataResource.format,
        url: udataResource.url,
        mimeType: udataResource.mime,
        size: udataResource.fileSize
      }
      return resource
    })
  }
  return dataset
}

export const createOrUpdateDataset = async (catalogConfig: UDataConfig, dataset: any, publication: Publication): Promise<Publication> => {
  const axiosOptions = { headers: { 'X-API-KEY': catalogConfig.apiKey } }

  const datasetUrl = catalogConfig.portal + '/' + dataset.id
  const resources = []
  if (!dataset.isMetaOnly) {
    resources.push({
      title: 'Documentation de l\'API',
      description: 'Documentation interactive de l\'API à destination des développeurs. La description de l\'API utilise la spécification [OpenAPI 3.1.1](https://github.com/OAI/OpenAPI-Specification)',
      url: datasetUrl + '/api-docs',
      type: 'documentation',
      filetype: 'remote',
      format: 'Page Web',
      mime: 'text/html'
    })
    resources.push({
      title: 'Consultez les données',
      description: `Consultez directement les données dans ${dataset.bbox ? 'une carte interactive' : 'un tableau'}.`,
      url: datasetUrl,
      type: 'main',
      filetype: 'remote',
      format: 'Page Web',
      mime: 'text/html'
    })
  }

  if (dataset.file) {
    const originalFileFormat = dataset.originalFile.name.split('.').pop()
    resources.push({
      title: `Fichier ${originalFileFormat}`,
      description: `Téléchargez le fichier complet au format ${originalFileFormat}.`,
      url: `${catalogConfig.portal}/api/v1/datasets/${dataset.id}/raw`,
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
        url: `${catalogConfig.portal}/data-fair/api/v1/datasets/${dataset.id}/convert`,
        type: 'main',
        filetype: 'remote',
        filesize: dataset.file.size,
        mime: dataset.file.mimetype,
        format: fileFormat
      })
    }
  }

  for (const attachment of dataset.attachments || []) {
    if (!attachment.includeInCatalogPublications) continue
    if (attachment.type === 'url') {
      resources.push({
        title: attachment.title,
        description: attachment.description,
        url: attachment.url
      })
    }
    if (attachment.type === 'file') {
      resources.push({
        title: attachment.title,
        description: attachment.description,
        url: `${catalogConfig.portal}/api/v1/datasets/${dataset.id}/metadata-attachments/${attachment.name}`,
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
        url: `${catalogConfig.portal}/api/v1/datasets/${dataset.id}/metadata-attachments/${attachment.name}`,
        filetype: 'remote',
        format: attachment.name.split('.').pop()
      })
    }
  }

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
  // We do not propagate spatial coverage for the moment as we can't push custom text
  // See https://www.data.gouv.fr/api/1/spatial/granularities/
  // if (dataset.spatial) udataDataset.spatial = { granularity: dataset.spatial }
  if (dataset.keywords && dataset.keywords.length) udataDataset.tags = dataset.keywords
  if (dataset.license) {
    const udataLicenses = (await axios.get<License[]>(new URL('api/1/datasets/licenses/', catalogConfig.url).href, axiosOptions)).data
    const udataLicense = udataLicenses.find(l => l.url === dataset.license.href)
    if (udataLicense) udataDataset.license = udataLicense.id
  }
  if (catalogConfig.organization?.id) udataDataset.organization = { id: catalogConfig.organization.id }

  // Try to retrive the distant dataset to update it
  if (publication.remoteDatasetId) {
    const existingUdataDataset = (await axios.get(new URL('api/1/datasets/' + publication.remoteDatasetId, catalogConfig.url).href, axiosOptions)).data
    if (!existingUdataDataset) {
      const res = await axios.post(new URL('api/1/datasets/', catalogConfig.url).href, udataDataset, axiosOptions)
      publication.remoteDatasetId = res.data.id
      return publication
    } else if (existingUdataDataset.deleted) {
      existingUdataDataset.deleted = null
    }

    // preserving resource id so that URLs are not broken
    if (existingUdataDataset.resources) {
      for (const resource of udataDataset.resources) {
        const matchingResource = existingUdataDataset.resources.find((r: { url?: string }) => resource.url === r.url)
        if (matchingResource) resource.id = matchingResource.id
      }
    }

    Object.assign(existingUdataDataset, udataDataset)
    await axios.put(new URL('api/1/datasets/' + publication.remoteDatasetId, catalogConfig.url).href, existingUdataDataset, axiosOptions)
  } else {
    const res = await axios.post(new URL('api/1/datasets/', catalogConfig.url).href, udataDataset, axiosOptions)
    publication.remoteDatasetId = res.data.id
  }

  return publication
}

export const deleteUdataDataset = async (catalogConfig: UDataConfig, datasetId: string) => {
  try {
    await axios.delete(new URL(`api/1/datasets/${datasetId}/`, catalogConfig.url).href, { headers: { 'X-API-KEY': catalogConfig.apiKey } })
  } catch (e: any) {
    if (![404, 410].includes(e.status)) throw httpError(500, `Erreur lors de la suppression du jeu de données sur ${catalogConfig.url} : ${e.message}`)
  }
}

export const addOrUpdateResource = async (catalogConfig: UDataConfig, dataset: any, publication: Publication): Promise<Publication> => {
  const axiosOptions = { headers: { 'X-API-KEY': catalogConfig.apiKey } }
  if (!publication.remoteDatasetId) throw httpError(400, 'Pas de jeu de données distant associé à cette publication')
  const udataDataset = (await axios.get(new URL('api/1/datasets/' + publication.remoteDatasetId, catalogConfig.url).href, axiosOptions)).data
  if (!udataDataset) throw httpError(404, 'Jeu de données distant introuvable')
  if (udataDataset.deleted) throw httpError(410, 'Jeu de données distant supprimé')

  // const existingUdataResource = (await axios.get(new URL('api/1/datasets/' + publication.remoteDatasetId + '/resources/' + publication.remoteResourceId, catalogConfig.url).href, axiosOptions)).data
  const existingUdataResource = udataDataset.resources.find((r: { id: string }) => r.id === publication.remoteResourceId)
  if (publication.remoteResourceId && existingUdataResource) { // Update it
    existingUdataResource.title = `${dataset.title} - Consultez les données`
    existingUdataResource.description = `Consultez directement les données dans ${dataset.bbox ? 'une carte interactive' : 'un tableau'}.`
    existingUdataResource.url = catalogConfig.portal + '/' + dataset.id
    await axios.put(new URL('api/1/datasets/' + publication.remoteDatasetId + '/resources/' + publication.remoteResourceId, catalogConfig.url).href, existingUdataResource, axiosOptions)
  } else { // Add it
    const resource = {
      title: `${dataset.title} - Consultez les données`,
      description: `Consultez directement les données dans ${dataset.bbox ? 'une carte interactive' : 'un tableau'}.`,
      url: catalogConfig.portal + '/' + dataset.id,
      type: 'main',
      filetype: 'remote',
      format: 'Page Web',
      mime: 'text/html'
    }

    const res = await axios.post(new URL('api/1/datasets/' + publication.remoteDatasetId + '/resources/', catalogConfig.url).href, resource, axiosOptions)
    publication.remoteResourceId = res.data.id
  }

  return publication
}

export const deleteUdataResource = async (catalogConfig: UDataConfig, datasetId: string, resourceId: string) => {
  try {
    await axios.delete(new URL(`api/1/datasets/${datasetId}/resources/${resourceId}`, catalogConfig.url).href, { headers: { 'X-API-KEY': catalogConfig.apiKey } })
  } catch (e: any) {
    if (![404, 410].includes(e.status)) throw httpError(500, `Erreur lors de la suppression de la ressource sur ${catalogConfig.url} : ${e.message}`)
  }
}
