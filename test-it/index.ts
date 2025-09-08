import type CatalogPlugin from '@data-fair/types-catalogs'
import { strict as assert } from 'node:assert'
import { it, describe, before, beforeEach } from 'node:test'
import fs from 'fs-extra'
import dotenv from 'dotenv'
import { logFunctions } from './test-utils.ts'

// Import plugin and use default type like it's done in Catalogs
import plugin from '../index.ts'
const catalogPlugin: CatalogPlugin = plugin as CatalogPlugin

// Load environment variables from .env file
dotenv.config()

/** Catalog configuration for testing purposes. */
const catalogConfig = {
  url: process.env.UDATA_URL || 'https://demo.data.gouv.fr',
  apiKey: '**************************************************'
}

/** Secrets for accessing the catalog API, including the API key. */
const secrets = {
  apiKey: process.env.UDATA_API_KEY || (() => {
    throw new Error('UDATA_API_KEY environment variable is required for tests')
  })()
}

describe('catalog-udata', () => {
  it('should list datasets as folders from root', async () => {
    const res = await catalogPlugin.list({
      catalogConfig,
      secrets,
      params: { showAll: 'true' }
    })

    assert.ok(res.count >= 0, 'Expected 0 or more items in the root folder')
    assert.ok(res.results.length >= 0)
    if (res.results.length > 0) {
      assert.equal(res.results[0].type, 'folder', 'Expected folders (datasets) in the root folder')
    }

    assert.equal(res.path.length, 0, 'Expected no path for root folder')
  })

  it('should list resources from a dataset (folder)', async () => {
    // First get a dataset to test with
    const rootRes = await catalogPlugin.list({
      catalogConfig,
      secrets,
      params: { showAll: 'true', size: 1, page: 1 }
    })
    assert.ok(rootRes.count >= 1, 'Expected 1 or more datasets in the root folder')
    assert.equal(rootRes.results.length, 1, 'Expected only one dataset in the results array')

    // List resources in the first dataset
    const datasetId = rootRes.results[0].id
    const res = await catalogPlugin.list({
      catalogConfig,
      secrets,
      params: { currentFolderId: datasetId }
    })

    assert.ok(res.count >= 1, 'Expected 1 or more resources in the dataset')
    assert.ok(res.results.length >= 1)
    assert.equal(res.results[0].type, 'resource', 'Expected resources in the dataset folder')

    assert.equal(res.path.length, 1, 'Expected path to contain the current dataset')
    assert.equal(res.path[0].id, datasetId)
  })

  it('should list resources with filters', async () => {
    const res = await catalogPlugin.list({
      catalogConfig,
      secrets,
      params: {
        showAll: 'true',
        organization: '589596c188ee3877169b81a4' // Koumoul organization ID
      }
    })

    assert.ok(res.count <= 500, 'Should not get all datasets, but only those from the Koumoul organization')
    assert.ok(res.results.length >= 1, 'Should return at least one dataset from the Koumoul organization')
  })

  describe('should get and download a resource', async () => {
    const tmpDir = './data/test/downloads'

    // Ensure the temporary directory exists once for all tests
    before(async () => await fs.ensureDir(tmpDir))

    // Clear the temporary directory before each test
    beforeEach(async () => await fs.emptyDir(tmpDir))

    it('with correct params', async () => {
      // First get a dataset and its resources
      const rootRes = await catalogPlugin.list({
        catalogConfig,
        secrets,
        params: {
          showAll: 'true',
          size: 1,
          page: 1,
          organization: '589596c188ee3877169b81a4' // Koumoul organization ID in demo.data.gouv.fr
        }
      })

      assert.ok(rootRes.count >= 1, 'Expected 1 or more datasets in the root folder')
      assert.equal(rootRes.results.length, 1, 'Expected only one dataset in the results array')

      const datasetId = rootRes.results[0].id
      const resourcesRes = await catalogPlugin.list({
        catalogConfig,
        secrets,
        params: { currentFolderId: datasetId }
      })

      assert.ok(resourcesRes.count >= 1, 'Expected 1 or more resources in the dataset')

      const resourceId = resourcesRes.results[0].id
      const resource = await catalogPlugin.getResource({
        catalogConfig,
        secrets,
        resourceId,
        importConfig: {}, // UData doesn't use importConfig
        tmpDir,
        log: logFunctions,
        update: {
          metadata: false,
          schema: false
        }
      })

      assert.ok(resource, 'The resource should exist')
      assert.equal(resource.id, resourceId, 'Resource ID should match')
      assert.ok(resource.title, 'Resource should have a title')
      assert.ok(resource.filePath, 'Download file path should not be undefined')

      // Check if the file exists
      const fileExists = await fs.pathExists(resource.filePath)
      assert.ok(fileExists, 'The downloaded file should exist')
    })

    it('should fail for resource not found', async () => {
      const resourceId = 'non-existent-dataset:non-existent-resource'

      await assert.rejects(
        async () => {
          await catalogPlugin.getResource({
            catalogConfig,
            secrets,
            resourceId,
            importConfig: {},
            tmpDir,
            log: logFunctions,
            update: {
              metadata: false,
              schema: false
            }
          })
        },
        /not found|does not exist|invalid/i,
        'Should throw an error for non-existent resource'
      )
    })
  })

  let remoteFolderId: string
  it('should publish a dataset', async () => {
    const dataset = {
      id: 'test-dataset',
      title: 'Test Dataset',
      description: 'This is a test dataset',
      slug: 'test-dataset',
      public: false
    }
    const publication = {
      action: 'createFolderInRoot' as const
    }
    const publicationSite = {
      title: 'Test Site',
      url: 'http://example.com',
      datasetUrlTemplate: 'http://example.com/data-fair/{id}'
    }

    const result = await catalogPlugin.publishDataset({
      catalogConfig,
      secrets,
      dataset,
      publication,
      publicationSite,
      log: logFunctions
    })
    assert.ok(result, 'The publication should be successful')
    assert.ok(result.remoteFolder, 'The returned publication should have a remote folder')
    assert.ok(result.remoteFolder.id, 'The returned publication should have a remote folder with an ID')
    remoteFolderId = result.remoteFolder.id
  })

  it('should delete a publication', async () => {
    await catalogPlugin.deletePublication({
      catalogConfig,
      secrets,
      folderId: remoteFolderId,
      log: logFunctions
    })
    // Since this is a test with demo API, we can't verify the deletion, but we can check that no error is thrown
    assert.ok(true, 'Delete operation should not throw an error')
  })
})
