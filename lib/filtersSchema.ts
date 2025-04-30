export default {
  type: 'object',
  additionalProperties: false,
  properties: {
    organization: {
      type: 'string',
      title: 'Organization',
      'x-i18n-title': {
        fr: 'Organisation'
      },
      description: 'Filter datasets by an organization.',
      'x-i18n-description': {
        fr: 'Filtrer les jeux de données par une organisation.'
      },
      layout: {
        getItems: {
          url: 'https://demo.data.gouv.fr/api/1/organizations/suggest/',
          itemTitle: 'item.name',
          itemValue: 'item.id',
          itemIcon: 'item.image_url',
          qSearchParam: 'q'
        },
        if: {
          expr: 'parent.data.showAll'
        },
        props: {
          placeholder: 'Search...',
          'x-i18n-placeholder': {
            fr: 'Rechercher...'
          }
        },
        cols: 8
      }
    },
    showAll: {
      type: 'boolean',
      title: 'Show all datasets',
      'x-i18n-title': {
        fr: 'Voir tous les jeux de données'
      },
      layout: {
        cols: 4,
        comp: 'switch'
      }
    }
  }
}
