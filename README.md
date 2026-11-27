# <img alt="Data FAIR logo" src="https://cdn.jsdelivr.net/gh/data-fair/data-fair@master/ui/public/assets/logo.svg" width="40"> @data-fair/catalog-udata

Udata plugin for the Data Fair catalogs service.

## How data.gouv.fr dates a dataset

The "last update" date that udata shows is not controlled by this plugin, and udata offers no API to set it.

- The plugin sends no date. All its resources are `filetype: "remote"` links to Data Fair (`/raw`, `/convert`, metadata attachments), and on update it resets the `harvest` of each resource and only sets `harvest.remote_url` on the dataset (`lib/publications.ts`).
- udata computes the dataset date as the most recent `last_modified` of its resources (`harvest.modified_at` only for harvested datasets, read-only through the API). A secondary attachment can therefore drive the date shown for the whole dataset.
- For a remote resource, `last_modified` comes from the hydra crawler (`extras["analysis:last-modified-at"]`), which reads the `Last-Modified` header of a `HEAD` request (5 s timeout, no fallback to `GET` on a timeout). It crawls on its own schedule (12 h, 24 h, 7 days, then 30 days at most), not at each publication. A `PUT` on the dataset, which the plugin does at each publication, triggers a new check.
- The analysis (checksum, schema, preview) is separate: it downloads the file and gives up above a size limit (100 MiB for CSV), showing "the robot could not access this file". That is a size limit, more bandwidth does not fix it, and it does not affect the date.

A date that stays frozen usually means the resource check fails or has fallen behind its schedule: look at its `check:date` and `check:timeout` extras, make sure the Data Fair URL answers `HEAD` quickly with a `Last-Modified` header, then publish again.

## Development

### Environment Variables

For running tests, you need to provide your UData API key via environment variables:

1. Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your actual UData API key:

   ```bash
   UDATA_API_KEY=your-actual-api-key-here
   ```

### Running Tests

```bash
npm test
```

The tests will use the environment variables from your `.env` file.