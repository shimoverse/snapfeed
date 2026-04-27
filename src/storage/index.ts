/**
 * snapfeed — Storage Adapters
 *
 * `StorageAdapter` uploads feedback media (screenshots, voice clips) and
 * returns a public URL. Use one of the bundled adapters or implement the
 * `StorageAdapter` interface against your own backend.
 */

export type {
  StorageAdapter,
  StorageUploadInput,
  StorageUploadResult,
  StorageDeleteResult,
  StorageEntry,
} from './types'
export { fileStorage, type FileStorageOptions } from './file'
export { s3Storage, type S3StorageOptions } from './s3'
export {
  pruneOlderThan,
  type PruneResult,
  type PruneOptions,
  type PruneCutoff,
  type PruneLogEntry,
} from './retention'
