import type { Publication, PublishDatasetContext, DeletePublicationContext } from '@data-fair/types-catalogs'
import type { UDataConfig } from '#types'

import axios from '@data-fair/lib-node/axios.js'
import { httpError } from '@data-fair/lib-utils/http-errors.js'
import { microTemplate } from '@data-fair/lib-utils/micro-template.js'

export const publishDataset = async (context: PublishDatasetContext<UDataConfig>): Promise<Publication> => {
  if (!context.secrets.apiKey) throw httpError(400, 'Aucune clé d\'API fournie pour le catalogue')
  if (context.publication.isResource) return addOrUpdateResource(context)
  else return await createOrUpdateDataset(context)
}

export const deleteDataset = async ({ catalogConfig, secrets, datasetId, resourceId }: DeletePublicationContext<UDataConfig>): Promise<void> => {
  if (!secrets.apiKey) throw httpError(400, 'Aucune clé d\'API fournie pour le catalogue')
  if (resourceId) return await deleteUdataResource(catalogConfig, secrets, datasetId, resourceId)
  else await deleteUdataDataset(catalogConfig, secrets, datasetId)
}

const createOrUpdateDataset = async ({ catalogConfig, secrets, dataset, publication, publicationSite }: PublishDatasetContext<UDataConfig>): Promise<Publication> => {
  const axiosOptions = { headers: { 'X-API-KEY': secrets.apiKey } }

  const datasetUrl = microTemplate(publicationSite.datasetUrlTemplate || '', { id: dataset.id, slug: dataset.slug })
  const resources = []
  if (dataset.isMetaOnly) {
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
        url: `${publicationSite.url}/api/v1/datasets/${dataset.id}/metadata-attachments/${attachment.name}`,
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
        url: `${publicationSite.url}/api/v1/datasets/${dataset.id}/metadata-attachments/${attachment.name}`,
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
  if (dataset.keywords && dataset.keywords.length) udataDataset.tags = dataset.keywords
  if (dataset.license) {
    const udataLicenses = (await axios.get<any[]>(new URL('api/1/datasets/licenses/', catalogConfig.url).href, axiosOptions)).data
    const udataLicense = udataLicenses.find(l => l.url === dataset.license.href)
    if (udataLicense) udataDataset.license = udataLicense.id
  }
  if (catalogConfig.organization?.id) udataDataset.organization = { id: catalogConfig.organization.id }

  // Try to retrive the distant dataset to update it
  if (publication.remoteDataset) {
    const existingUdataDataset = (await axios.get(new URL('api/1/datasets/' + publication.remoteDataset.id, catalogConfig.url).href, axiosOptions)).data
    // If the dataset no longer exists, we create it
    if (!existingUdataDataset) {
      const res = await axios.post(new URL('api/1/datasets/', catalogConfig.url).href, udataDataset, axiosOptions)
      publication.remoteDataset = {
        id: res.data.id,
        title: res.data.title,
      }
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
    await axios.put(new URL('api/1/datasets/' + publication.remoteDataset.id, catalogConfig.url).href, existingUdataDataset, axiosOptions)
  } else {
    const res = await axios.post(new URL('api/1/datasets/', catalogConfig.url).href, udataDataset, axiosOptions)
    publication.remoteDataset = {
      id: res.data.id,
      title: res.data.title,
      url: res.data.page
    }
  }

  return publication
}

const deleteUdataDataset = async (catalogConfig: UDataConfig, secrets: Record<string, string>, datasetId: string) => {
  try {
    await axios.delete(new URL(`api/1/datasets/${datasetId}/`, catalogConfig.url).href, { headers: { 'X-API-KEY': secrets.apiKey } })
  } catch (e: any) {
    if (![404, 410].includes(e.status)) throw httpError(500, `Erreur lors de la suppression du jeu de données sur ${catalogConfig.url} : ${e.message}`)
  }
}

const addOrUpdateResource = async ({ catalogConfig, secrets, dataset, publication, publicationSite }: PublishDatasetContext<UDataConfig>): Promise<Publication> => {
  const axiosOptions = { headers: { 'X-API-KEY': secrets.apiKey } }
  if (!publication.remoteDataset) throw httpError(400, 'Pas de jeu de données distant associé à cette publication')
  const udataDataset = (await axios.get(new URL('api/1/datasets/' + publication.remoteDataset.id, catalogConfig.url).href, axiosOptions)).data
  if (!udataDataset) throw httpError(404, 'Jeu de données distant introuvable')
  if (udataDataset.deleted) throw httpError(410, 'Jeu de données distant supprimé')

  const existingUdataResource = udataDataset.resources.find((r: { id: string }) => r.id === publication.remoteResource?.id)
  if (publication.remoteResource && existingUdataResource) { // Update it
    existingUdataResource.title = `${dataset.title} - Consultez les données`
    existingUdataResource.description = `Consultez directement les données dans ${dataset.bbox ? 'une carte interactive' : 'un tableau'}.`
    existingUdataResource.url = microTemplate(publicationSite.datasetUrlTemplate || '', { id: dataset.id, slug: dataset.slug })
    await axios.put(new URL('api/1/datasets/' + publication.remoteDataset.id + '/resources/' + publication.remoteResource.id, catalogConfig.url).href, existingUdataResource, axiosOptions)
  } else { // Add it
    const resource = {
      title: `${dataset.title} - Consultez les données`,
      description: `Consultez directement les données dans ${dataset.bbox ? 'une carte interactive' : 'un tableau'}.`,
      url: microTemplate(publicationSite.datasetUrlTemplate || '', { id: dataset.id, slug: dataset.slug }),
      type: 'main',
      filetype: 'remote',
      format: 'Page Web',
      mime: 'text/html'
    }

    const res = await axios.post(new URL('api/1/datasets/' + publication.remoteDataset.id + '/resources/', catalogConfig.url).href, resource, axiosOptions)
    publication.remoteResource = {
      id: res.data.id,
      title: res.data.title
    }
    publication.remoteDataset.url = udataDataset.page
  }

  return publication
}

const deleteUdataResource = async (catalogConfig: UDataConfig, secrets: Record<string, string>, datasetId: string, resourceId: string) => {
  try {
    await axios.delete(new URL(`api/1/datasets/${datasetId}/resources/${resourceId}`, catalogConfig.url).href, { headers: { 'X-API-KEY': secrets.apiKey } })
  } catch (e: any) {
    if (![404, 410].includes(e.status)) throw httpError(500, `Erreur lors de la suppression de la ressource sur ${catalogConfig.url} : ${e.message}`)
  }
}
