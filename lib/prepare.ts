import type { PrepareContext } from '@data-fair/lib-common-types/catalog/index.js'
import type { UDataCapabilities } from './capabilities.ts'
import type { UDataConfig } from '#types'

export default async ({ catalogConfig, capabilities, secrets }: PrepareContext<UDataConfig, UDataCapabilities>) => {
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

  if (secrets?.apiKey) {
    if (!capabilities.includes('publishDataset')) capabilities.push('publishDataset')
  } else capabilities = capabilities.filter(c => c !== 'publishDataset')

  return {
    catalogConfig,
    capabilities,
    secrets
  }
}
