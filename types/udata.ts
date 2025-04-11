/** https://doc.data.gouv.fr/api/reference/#/datasets/list_licenses */
export type License = {
  alternate_titles?: string[]
  alternate_urls?: string[]
  flags?: string[]
  id: string
  maintainer?: string
  title: string
  url?: string
}
