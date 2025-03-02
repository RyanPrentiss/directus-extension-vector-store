type EmbedderConfig = {
    index: string
    baseUrl: string
    model: string
}

type Chunk = {
    size: number
    overlap: number
}

type FileConfig = {
    chunk: Chunk
    path: string
    type?: string
}

type FileMetadata = {
    fileName: string
    filePath: string
    processedAt: string
    chunkKeys?: string[]
}