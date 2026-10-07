import { describe, expect, it } from 'vitest'
import {
  MAX_CSV_FILE_SIZE_BYTES,
  clientUploadRejection,
} from './uploadLimits'

describe('client CSV upload checks', () => {
  it('accepts a normal csv under the documented size', () => {
    expect(
      clientUploadRejection({ name: 'Apple Ads.csv', size: 1024 }),
    ).toBe('')
  })

  it('rejects a non-csv name before upload', () => {
    expect(clientUploadRejection({ name: 'report.xlsx', size: 100 })).toBe(
      'Only CSV files are allowed',
    )
  })

  it('rejects an obviously oversized file before upload', () => {
    expect(
      clientUploadRejection({
        name: 'report.csv',
        size: MAX_CSV_FILE_SIZE_BYTES + 1,
      }),
    ).toBe('CSV file exceeds the maximum allowed size')
  })
})
