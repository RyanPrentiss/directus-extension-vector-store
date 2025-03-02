# Directus Extension: Vector Store

The **Directus Extension: Vector Store** is a plugin designed to manage the processing and storage of document embeddings for vector search capabilities. This extension can extract, process, and store document data in Redis, allowing vector-based queries to be performed efficiently.

## Features

- Supports both file and URL-based document processing.
- Embeds and stores document data into a Redis vector store.
- Provides endpoints to manage, process, and retrieve processed files.
- Includes UI components for uploading files and displaying processed data.
- Performs health checks to ensure service readiness.

## Installation

1. **Install via npm:**
   Ensure you have Node.js installed, then run:

   ```bash
   npm install directus-extension-vector-store
   ```

2. **Configure Environment:**
   Set up the necessary environment variables:

   ```plaintext
   REDIS=redis://your_redis_url
   RAG_INDEX=your_index_name
   LLM_URL=your_llm_url
   LLM_EMBEDDING=your_llm_embedding
   ```

## Usage

- **File Processing:** Upload files via the `/embed-vector` endpoint. This accepts a single file upload, processes it, splits it into chunks, and stores the embeddings in Redis.
- **Health Check:** Use other mechanisms, such as basic server response validation (e.g., hitting the root endpoint).
- **List Vectors:** Retrieve metadata of processed files using the `/get-vectors` endpoint.
- **Delete Vectors:** Remove specific documents from the vector store using the `/del-vector` endpoint.

### Endpoints

- **`/embed-vector`**: POST request to upload and process a file into embeddings.
- **`/get-vectors`**: GET request to retrieve a list of processed vector metadata.
- **`/del-vector`**: DELETE request to remove a specific vector from storage.
- **`/`**: Basic GET request returning "Hello World!" to ensure the server is running.

## Contributing

Contributions are welcome! Fork the repository and submit a pull request. For major changes, please open an issue first to discuss what you would like to change.

## License

This extension is licensed under the MIT License.
