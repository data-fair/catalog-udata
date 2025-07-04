import type { PrepareContext } from '@data-fair/types-catalogs'
import type { UDataCapabilities } from './capabilities.ts'
import type { UDataConfig } from '#types'

import axios from '@data-fair/lib-node/axios.js'

export default async ({ catalogConfig, capabilities, secrets }: PrepareContext<UDataConfig, UDataCapabilities>) => {
  // Manage secrets
  const apiKey = catalogConfig.apiKey
  // If the config contains a secretField, and it is not already hidden
  if (apiKey && apiKey !== '**************************************************') {
    // Hide the secret in the catalogConfig, and copy it to secrets
    secrets.apiKey = apiKey
    catalogConfig.apiKey = '**************************************************'

  // If the secretField is in the secrets, and empty in catalogConfig,
  // then it means the user has cleared the secret in the config
  } else if (secrets?.apiKey && apiKey === '') {
    delete secrets.apiKey
  }

  // Manage capabilities
  if (secrets?.apiKey) {
    if (!capabilities.includes('publishDataset')) capabilities.push('publishDataset')
  } else capabilities = capabilities.filter(c => c !== 'publishDataset')

  // Check if the APIkey is valid by getting the user info
  if (secrets?.apiKey) {
    let user
    try {
      user = (await axios.get(`${catalogConfig.url}/api/1/me`, {
        headers: {
          'X-API-KEY': secrets.apiKey
        }
      })).data
    } catch (error: any) {
      if (error.status === 401) throw new Error('Invalid API key')
      throw new Error(`UData validation failed: ${error.message || 'Unknown error'}`)
    }

    // If they are an organization, check if the user has the right on this organization
    if (catalogConfig.organization?.id && !user.organizations.some((org: any) => org.id === catalogConfig.organization!.id)) {
      throw new Error(`User does not have access to organization ${catalogConfig.organization.name}`)
    }
  }

  return {
    catalogConfig,
    capabilities,
    secrets
  }
}
