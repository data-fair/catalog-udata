export default {
  type: 'object',
  additionalProperties: false,
  properties: {
    organization: {
      type: 'object',
      title: 'Organization',
      'x-i18n-title': {
        fr: 'Organisation'
      },
      description: 'Filter datasets by an organization.',
      'x-i18n-description': {
        fr: 'Filtrer les jeux de données par une organisation.'
      },
      required: [
        'id',
        'name'
      ],
      properties: {
        id: {
          type: 'string'
        },
        name: {
          type: 'string'
        },
        image_url: {
          type: 'string'
        }
      },
      layout: {
        getItems: {
          url: 'https://demo.data.gouv.fr/api/1/organizations/suggest/',
          itemTitle: 'item.name',
          itemIcon: 'item.image_url',
          qSearchParam: 'q'
        },
        if: {
          expr: '!parent.data.me'
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
    onlyMe: {
      type: 'boolean',
      title: 'My datasets only',
      'x-i18n-title': {
        fr: 'Mes jeux de données uniquement'
      },
      layout: {
        cols: 4
      }
    }
  }
}
