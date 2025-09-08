import type { Metadata } from '@data-fair/types-catalogs'

const i18n: Metadata['i18n'] = {
  en: {
    description: 'Import / publish datasets from / to a Udata catalog. (e.g., data.gouv.fr)',
    actionLabels: {
      createFolderInRoot: 'Create a new dataset',
      createResource: 'Add as a file',
      replaceFolder: 'Replace an existing dataset',
      replaceResource: 'Replace an existing resource'
    },
    actionButtons: {
      createFolderInRoot: 'Create dataset',
      createResource: 'Add file',
      replaceFolder: 'Replace this dataset',
      replaceResource: 'Replace file'
    },
    stepTitles: {
      createResource: 'Select the dataset to which to add the file',
      replaceFolder: 'Select the dataset to replace',
      replaceResource: 'Select the file to replace'
    }
  },
  fr: {
    description: 'Importez / publiez des jeux de données depuis / vers un catalogue Udata. (ex. : data.gouv.fr)',
    actionLabels: {
      createFolderInRoot: 'Créer un nouveau jeu de données',
      createResource: 'Ajouter en tant que fichier',
      replaceFolder: 'Remplacer un jeu de données existant',
      replaceResource: 'Remplacer une ressource existante'
    },
    actionButtons: {
      createFolderInRoot: 'Créer le jeu de données',
      createResource: 'Ajouter le fichier',
      replaceFolder: 'Remplacer ce jeu de données',
      replaceResource: 'Remplacer le fichier'
    },
    stepTitles: {
      createResource: 'Sélection du jeu de données où ajouter le fichier',
      replaceFolder: 'Sélection du jeu de données à remplacer',
      replaceResource: 'Sélection du fichier à remplacer'
    }
  }
}

export default i18n
