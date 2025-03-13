/**
 * Embedding Processing Pipeline
 * 
 * Handles document loading, text splitting, and embedding storage
 */

// Core dependencies
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf"
import { YoutubeLoader } from "@langchain/community/document_loaders/web/youtube"
import { Document } from "@langchain/core/documents"
import { OllamaEmbeddings } from '@langchain/ollama'
import { RedisVectorStore } from '@langchain/redis'
import axios from 'axios'
import * as cheerio from 'cheerio'
import { TextLoader } from 'langchain/document_loaders/fs/text'
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'
// import mime from 'mime-types'
import { nanoid } from "nanoid"
import { RedisClientType } from 'redis'



/**
 * Main processing pipeline for converting files to embeddings
 */
export async function processAndStoreEmbeddings(
    fileConfig: FileConfig,
    redisClient: RedisClientType,
    emConfig: EmbedderConfig,
): Promise<string[]> {
    const loader = await getDocumentLoader(fileConfig.path, fileConfig.type)
    console.log("1. Documents Loaded")

    const chunk: Chunk = {
        overlap: fileConfig.chunk.overlap || 200,
        size: fileConfig.chunk.size || 1000
    }
    const documents = await loadAndSplitDocuments(loader, chunk)
    console.log("2. Documents Split")
    return storeEmbeddings(documents, redisClient, emConfig)
}

/**
 * Selects the appropriate document loader based on file type/URL
 */
async function getDocumentLoader(filePath: string, mimeType: string | undefined) {
    // Handle URL-based resources
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
        const url = new URL(filePath)

        // YouTube video handling
        if (url.hostname.includes('youtube.com') || url.hostname.includes('youtu.be')) {
            return YoutubeLoader.createFromUrl(filePath, {
                language: 'en', // Default to English captions
                addVideoInfo: true, // Include video metadata
            })
        }

        // Handle standard web pages
        return {
            // Fake loader interface for webpage
            load: async (): Promise<Document[]> => {
                // Fetch the page content
                const response = await axios.get(filePath)

                // Parse HTML and extract text
                const $ = cheerio.load(response.data)
                const content = $('body').text() || ''

                const doc = new Document({
                    pageContent: content,
                    metadata: {
                        source: filePath,
                        createdAt: new Date().toISOString(),
                    }
                })

                // Return as a single document because loader expects an array
                return [doc]
            },
        }
    }

    // Handle local files
    console.log(`Detected MIME type: ${mimeType} - ${filePath}`)

    switch (mimeType) {
        case 'application/pdf':
            return new PDFLoader(filePath)

        case 'text/csv':
        case 'text/markdown':
        case 'text/plain':
            return new TextLoader(filePath)

        default:
            throw new Error(`Unsupported file type: ${mimeType || 'unknown'}`)
    }
}

/**
 * Loads and splits documents into chunks
 */
async function loadAndSplitDocuments(
    loader: any,
    chunk: Chunk
) {
    // Load raw documents
    const rawDocs = await loader.load()
    // Configure text splitter with hierarchical chunking
    const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: chunk.size,
        chunkOverlap: chunk.overlap,
        separators: ['\n\n', '\n', ' ', ''], // Split hierarchy
    })

    // Split documents into manageable chunks
    return textSplitter.splitDocuments(rawDocs)
}

/**
 * Generates embeddings and stores them in Redis
 */
async function storeEmbeddings(
    documents: any[],
    redisClient: RedisClientType,
    config: EmbedderConfig
): Promise<string[]> {
    console.log("Creating embeddings instance...")
    const embeddings = new OllamaEmbeddings({ model: config.model, baseUrl: config.baseUrl })

    const chunkKeys: string[] = []
    const keyPrefix = `rds:${nanoid()}:`
    console.log(`Using key prefix: ${keyPrefix}`)

    // Generate unique keys with index
    for (let i = 0; i < documents.length; i++) {
        const uniqueKey = `${keyPrefix}${i}`
        documents[i].metadata.id = uniqueKey // Set FULL key as ID
        chunkKeys.push(uniqueKey)
    }

    console.log("Generating embeddings and storing in Redis...")
    await RedisVectorStore.fromDocuments(
        documents,
        embeddings,
        {
            redisClient,
            indexName: config.index,
            keyPrefix,
        }
    ).catch(error => {
        console.error("Error in RedisVectorStore.fromDocuments:", error)
        console.error("Stack trace:", error.stack)
        throw error
    })

    console.log(`Successfully stored ${chunkKeys.length} embeddings`)
    return chunkKeys
}

