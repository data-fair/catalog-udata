import { strict as assert } from 'node:assert'
import { it, describe } from 'node:test'
import { getFileExtension } from '../lib/file-extension.ts'

describe('getFileExtension', () => {
  it('keeps the inner extension of gzipped files', () => {
    assert.equal(getFileExtension('/datasets/r/decp.csv.gz'), '.csv.gz')
    assert.equal(getFileExtension('/data/FILE.JSON.GZ'), '.json.gz')
  })

  it('falls back on the udata format for gzipped files without inner extension', () => {
    assert.equal(getFileExtension('/download/decp.gz', 'csv.gz'), '.csv.gz')
    assert.equal(getFileExtension('/download/decp.gz', 'csv'), '.csv.gz')
    assert.equal(getFileExtension('/download/decp.gz', 'gz'), '.gz')
    assert.equal(getFileExtension('/download/decp.gz'), '.gz')
  })

  it('uses the plain URL extension', () => {
    assert.equal(getFileExtension('/data/decp.parquet'), '.parquet')
    assert.equal(getFileExtension('/data/archive.zip'), '.zip')
  })

  it('falls back on the content type, then .dat', () => {
    assert.equal(getFileExtension('/api/export', undefined, 'text/csv; charset=utf-8'), '.csv')
    assert.equal(getFileExtension('/api/export', undefined, 'application/json'), '.json')
    assert.equal(getFileExtension('/api/export'), '.dat')
  })
})
