
import { useEnv } from '@directus/env'
import axios, { AxiosError } from 'axios'
import { Request, Response } from 'express'
import * as fs from 'fs'
import { createClient, RedisClientType } from "redis"
import { z } from 'zod'
import { processAndStoreEmbeddings } from './embedding-processor.js'

interface MulterRequest extends Request {
    file?: Express.Multer.File
}

export class RDSVectorStore {
    private redisClient: RedisClientType
    private emConfig: EmbedderConfig
    private connectionPromise: Promise<void> | null = null

    constructor() {
        const env = useEnv()

        this.emConfig = {
            index: z.string().parse(env.RAG_INDEX),
            baseUrl: z.string().parse(env.LLM_URL),
            model: z.string().parse(env.LLM_EMBEDDING)
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

        this.redisClient = createClient({
            url: String(redisUrl),
            socket: {
                family: 0,
                reconnectStrategy: (retries) => Math.min(Math.pow(2, retries) * 100, 10000),
            }
        })
    }

    // Ensures Redis connection is active
    private async ensureConnection(): Promise<void> {
        if (this.redisClient.isOpen) return

        if (!this.connectionPromise) {
            this.connectionPromise = (async () => {
                try {
                    console.log('Attempting Redis connection...')
                    await this.redisClient.connect()
                } catch (error) {
                    console.error('Connection failed:', error)
                    throw error
                } finally {
                    this.connectionPromise = null // Reset on success/failure
                }
            })()
        }

        return this.connectionPromise
    }

    // Safely executes Redis operations with proper connection management
    private async withRedisConnection<T>(operation: () => Promise<T>): Promise<T> {
        try {
            await this.ensureConnection()
            return await operation()
        } catch (error) {
            console.error('Redis operation error:', error)
            throw error
        }
    }

    get = async (_req: Request, res: Response) => {
        try {
            const processedFiles = await this.withRedisConnection(async () => {
                // Retrieve all entries from the "rds:processed_files" list
                const files = await this.redisClient.lRange('rds:processed_files', 0, -1) as string[]

                // Parse each entry from JSON
                return files.map((entry) => {
                    try {
                        return JSON.parse(entry)
                    } catch {
                        return entry
                    }
                })
            })

            res.status(200).json({ files: processedFiles })
        } catch (error: any) {
            console.error('Error retrieving processed files:', error)
            // Handle cases where error.message might be undefined
            const errorMessage = error instanceof Error ? error.message : String(error)
            res.status(500).json({
                message: 'Error retrieving processed files.',
                error: errorMessage
            })
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
                // filePath = req.body.filePath
                // originalFileName = await this.getPageTitle(req.body.filePath)

                filePath = z.string().url().parse(req.body.filePath)
                originalFileName = await this.getPageTitle(filePath)
            }

            if (!filePath) return res.status(400).json({ message: 'File required' })

            // Process embeddings and get chunk keys
            const fileConfig: FileConfig = {
                path: filePath,
                type: req.file?.mimetype === 'application/octet-stream'
                    ? this.getMimeTypeFromExtension(req.file.originalname) // Add this method
                    : req.file?.mimetype,
                chunk: {
                    overlap: 200,
                    size: 1000
                }
            }

            await this.withRedisConnection(async () => {
                const chunkKeys = await processAndStoreEmbeddings(
                    fileConfig,
                    this.redisClient,
                    this.emConfig
                )

                // Store metadata with chunk keys
                const metadata = {
                    fileName: originalFileName,
                    filePath,
                    processedAt: new Date().toISOString(),
                    chunkKeys // Store keys for future deletion
                }
                await this.redisClient.lPush('rds:processed_files', JSON.stringify(metadata))
            })

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

    private getMimeTypeFromExtension(filename: string): string {
        const extension = filename.split('.').pop()?.toLowerCase()
        switch (extension) {
            case 'csv': return 'text/csv'
            case 'md': return 'text/markdown'
            case 'txt': return 'text/plain'
            default: return 'application/octet-stream'
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
            const found = await this.withRedisConnection(async () => {
                // Get all metadata entries atomically
                const files = await this.redisClient.lRange('rds:processed_files', 0, -1) as string[]
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
                                const pipeline = this.redisClient.multi()
                                for (const key of metadata.chunkKeys) {
                                    pipeline.del(key)
                                }
                                await pipeline.exec()
                            }

                            // Remove THIS SPECIFIC list entry by index
                            await this.redisClient.lSet('rds:processed_files', i, '__DELETED__')
                            await this.redisClient.lRem('rds:processed_files', 1, '__DELETED__')
                        }
                    } catch {
                        /* Silent parse errors */
                        continue
                    }
                }
                return found
            })

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

    // Optional: Method to gracefully close the Redis connection when needed
    async closeConnection(): Promise<void> {
        if (this.redisClient.isOpen) {
            await this.redisClient.disconnect()
        }
    }
}
