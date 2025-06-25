export const capabilities = [
  'import' as const,
  'search' as const,
  'pagination' as const,
  'additionalFilters' as const,
  'publishDataset' as const,
  'deletePublication' as const,
]

export type UDataCapabilities = typeof capabilities
export default capabilities
