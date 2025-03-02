import { useEnv } from '@directus/env'
import axios, { AxiosError } from 'axios'
import { Request, Response } from 'express'
import * as fs from 'fs'
import { createClient } from "redis"
import { processAndStoreEmbeddings } from './embedding-processor.js'

interface MulterRequest extends Request {
    file?: Express.Multer.File
}

const env = useEnv()

const getEnvVar = (key: string): string => {
    const value = env[key]
    if (typeof value !== 'string') {
        throw new Error(`Missing or invalid environment variable: ${key}`)
    }
    return value
}
const emConfig: EmbedderConfig = {
    index: getEnvVar('RAG_INDEX'),
    baseUrl: getEnvVar('LLM_URL'),
    model: getEnvVar('LLM_EMBEDDING')
}

const redisUrl = env.REDIS ||
    (env.REDIS_HOST && env.REDIS_PORT && env.REDIS_USERNAME && env.REDIS_PASSWORD
        ? `redis://${env.REDIS_USERNAME}:${env.REDIS_PASSWORD}@${env.REDIS_HOST}:${env.REDIS_PORT}`
        : null)
if (!redisUrl) {
    throw new Error(
        'Missing Redis configuration. Either REDIS or REDIS_HOST, REDIS_PORT, REDIS_USERNAME, and REDIS_PASSWORD must be provided.'
    )
}

// Retrieve the Redis URL from environment variables or default to 'redis://cache:6379'
// const redisUrl = redis_url || 'redis://cache:6379'
const RC = createClient({ url: redisUrl as string })
await RC.connect()

export class RDSVectorStore {
    get = async (_req: Request, res: Response) => {
        try {
            // Retrieve all entries from the "processed_files" list
            const files = await RC.lRange('processed_files', 0, -1) as string[]

            // Parse each entry from JSON
            const processedFiles = files.map((entry) => {
                try {
                    return JSON.parse(entry)
                } catch {
                    return entry
                }
            })
            res.status(200).json({ files: processedFiles })
        } catch (error: any) {
            console.error('Error retrieving processed files:', error)
            res.status(500).json({ message: 'Error retrieving processed files.', error: error.message })
        }
    }

    embed = async (req: MulterRequest, res: Response) => {
        let filePath: string | undefined
        let originalFileName: string | undefined

        try {
            if (req.file) {
                // Handle file upload
                filePath = req.file.path
                originalFileName = req.file.originalname
            } else {
                // Handle URL
                filePath = req.body.filePath
                originalFileName = await this.getPageTitle(req.body.filePath)
            }

            if (!filePath) return res.status(400).json({ message: 'File required' })

            // Process embeddings and get chunk keys
            const fileConfig: FileConfig = {
                path: filePath,
                type: req.file?.mimetype,
                chunk: {
                    overlap: 200,
                    size: 1000
                }
            }
            const chunkKeys = await processAndStoreEmbeddings(
                fileConfig,
                redisUrl as string,
                emConfig
            )

            // Store metadata with chunk keys
            try {
                const metadata = {
                    fileName: originalFileName,
                    filePath,
                    processedAt: new Date().toISOString(),
                    chunkKeys // Store keys for future deletion
                }
                await RC.lPush('processed_files', JSON.stringify(metadata))
            } finally {
                if (req.file) fs.unlink(req.file.path, () => { })
            }


            return res.status(200).json({ message: 'File processed successfully' })
        } catch (error: any) {
            console.error('Processing error:', error)
            return res.status(500).json({
                message: 'Error processing file',
                error: error.message
            })
        } finally {
            if (req.file) fs.unlink(req.file.path, () => { })
        }
    }

    getPageTitle = async (url: string): Promise<string> => {
        try {
            const response = await axios.get(url)
            const titleMatch = response.data.match(/<title[^>]*>([^<]+)<\/title>/)

            return titleMatch ? titleMatch[1].trim() : 'No title found'
        } catch (error) {
            const message = error instanceof AxiosError ? error.message : 'Unknown error occurred'
            throw new Error(`Failed to fetch title: ${message}`)
        }
    }

    delete = async (req: Request, res: Response) => {
        const { filePath } = req.body
        if (!filePath) return res.status(400).json({ message: 'filePath required' })

        try {
            // Get all metadata entries atomically
            const files = await RC.lRange('processed_files', 0, -1) as string[]
            let found = false

            console.log(`Deleting file metadata for path: ${filePath}`)
            console.log(`Files: ${files}`)

            // Process in reverse to avoid index shifting
            for (let i = files.length - 1; i >= 0; i--) {
                const metadataStr = files[i]

                // Handle missing/undefined entries
                if (!metadataStr) continue

                try {
                    const metadata = JSON.parse(metadataStr) as FileMetadata
                    if (metadata.filePath === filePath) {
                        found = true

                        // Delete chunk keys in batches (Redis allows multiple DELs)
                        if (metadata.chunkKeys?.length) {
                            const pipeline = RC.multi()
                            for (const key of metadata.chunkKeys) {
                                pipeline.del(key)
                            }
                            await pipeline.exec()
                        }

                        // Remove THIS SPECIFIC list entry by index
                        await RC.lSet('processed_files', i, '__DELETED__')
                        await RC.lRem('processed_files', 1, '__DELETED__')
                    }
                } catch {
                    /* Silent parse errors */
                    continue
                }
            }

            if (!found) return res.status(404).json({ message: 'File not found' })
            return res.status(200).json({ message: 'Embeddings deleted' })
        } catch (error: any) {
            console.error('Deletion error:', error)
            return res.status(500).json({
                message: 'Deletion failed',
                error: error.message
            })
        }
    }
}