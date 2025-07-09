import type { CatalogPlugin, ListContext, Folder, Resource, GetResourceContext } from '@data-fair/types-catalogs'
import type { UDataConfig } from '#types'
import type { UDataCapabilities } from './capabilities.ts'

import axios from '@data-fair/lib-node/axios.js'

export const list = async ({ catalogConfig, secrets, params }: ListContext<UDataConfig, UDataCapabilities>): ReturnType<CatalogPlugin['list']> => {
  const axiosOptions: Record<string, any> = { headers: {}, params: {} }
  if (secrets.apiKey) axiosOptions.headers['X-API-KEY'] = secrets.apiKey
  if (params.q) axiosOptions.params.q = params.q

  // Si currentFolderId est présent, on récupère les ressources du dataset
  if (params.currentFolderId) {
    // Récupérer le dataset spécifique
    const datasetResponse = await axios.get(new URL(`api/1/datasets/${params.currentFolderId}`, catalogConfig.url).href, axiosOptions)
    const dataset = datasetResponse.data

    type ResourceList =
      Pick<
        Resource,
        'id' | 'title' | 'description' | 'format' | 'mimeType' | 'origin' | 'size'
      > & {
        type: 'resource'
      }

    // Convertir les ressources du dataset en format ResourceList
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

    // Construire le path avec le folder du dataset
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

  // Si pas de currentFolderId, on liste les datasets comme folders (niveau racine)
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

  // Convertir les datasets en folders
  const folders: Folder[] = datasets.map((dataset: any) => ({
    id: dataset.id,
    title: dataset.title,
    type: 'folder'
  }))

  return {
    count,
    results: folders,
    path: [] // Path vide pour le niveau racine
  }
}

export const getResource = async ({ catalogConfig, secrets, resourceId, tmpDir }: GetResourceContext<UDataConfig>): ReturnType<CatalogPlugin['getResource']> => {
  // Décoder l'ID composite (format: "datasetId:resourceId")
  const parts = resourceId.split(':')
  if (parts.length !== 2) {
    throw new Error(`Format d'ID de ressource invalide: ${resourceId}. Attendu: "datasetId:resourceId"`)
  }
  const [datasetId, udataResourceId] = parts

  // Configuration axios avec API key si disponible
  const axiosOptions: Record<string, any> = { headers: {} }
  if (secrets.apiKey) axiosOptions.headers['X-API-KEY'] = secrets.apiKey

  // Récupérer le dataset contenant la ressource
  const datasetResponse = await axios.get(
    new URL(`api/1/datasets/${datasetId}`, catalogConfig.url).href,
    axiosOptions
  )
  const dataset = datasetResponse.data

  // Trouver la ressource spécifique dans le dataset
  const udataResource = dataset.resources?.find((r: any) => r.id === udataResourceId)
  if (!udataResource) {
    throw new Error(`Ressource ${udataResourceId} non trouvée dans le dataset ${datasetId}`)
  }

  if (!udataResource.url) {
    throw new Error(`URL manquante pour la ressource ${udataResourceId}`)
  }

  // Télécharger la ressource
  const fs = await import('node:fs')
  const path = await import('path')

  const response = await axios.get(udataResource.url, {
    responseType: 'stream'
  })

  // Déterminer l'extension du fichier à partir de l'URL ou du Content-Type
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

  // Créer un nom de fichier
  const resourceTitle = udataResource.title?.replace(/[^a-zA-Z0-9]/g, '_') || 'resource'
  const fileName = `${resourceTitle}${extension}`
  const filePath = path.join(tmpDir, fileName)

  // Créer le stream d'écriture
  const writeStream = fs.createWriteStream(filePath)
  response.data.pipe(writeStream)

  // Retourner une promesse qui se résout avec le chemin du fichier
  await new Promise((resolve, reject) => {
    writeStream.on('finish', () => resolve(filePath))
    writeStream.on('error', (error) => reject(error))
  })

  const udataLicenses: { id: string, title: string, url: string }[] = (await axios.get(new URL('api/1/datasets/licenses', catalogConfig.url).href, axiosOptions)).data
  const udataLicense = udataLicenses.find((l: any) => l.id === udataResource.license)
  const license = udataLicense ? { title: udataLicense.title, href: udataLicense.url } : undefined

  const resource: Resource = {
    id: resourceId,
    title: udataResource.title,
    description: dataset.description,
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
