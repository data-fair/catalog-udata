# <img alt="Data FAIR logo" src="https://cdn.jsdelivr.net/gh/data-fair/data-fair@master/ui/public/assets/logo.svg" width="40"> @data-fair/catalog-udata

Udata plugin for the Data Fair catalogs service.

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