/* eslint-disable no-template-curly-in-string */
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
          url: '${context.catalogConfig.url}/api/1/organizations/suggest/',
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
        fr: 'Afficher les jeux de données d\'autres organisations'
      },
      default: true,
      layout: {
        switch: [
          {
            if: '!context.catalogConfig.apiKey',
            readOnly: true,
            cols: 4,
            comp: 'switch'
          },
          {
            cols: 4,
            comp: 'switch'
          }
        ]
      }
    }
  }
}
