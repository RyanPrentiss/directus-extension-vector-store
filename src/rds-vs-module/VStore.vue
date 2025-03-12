<template>
    <private-view title="Agent Memory Management">
        <div class="agent-panel">
            <p>Upload a file or enter a URL to add to Agent memory.</p>
            <!-- Toggle Buttons -->
            <div class="input-toggle-buttons">
                <button @click="selectFileInput" :class="{ active: selectedInput === 'file' }">FILE</button>
                <button @click="selectUrlInput" :class="{ active: selectedInput === 'url' }">URL</button>
            </div>

            <!-- File Input Section -->
            <div v-if="selectedInput === 'file'" class="file-data">
                <!-- Hidden file input -->
                <input type="file" ref="fileInput" @change="handleFileChange" class="file-input" hidden />
                <!-- Button to trigger file selection -->
                <button @click="triggerFileSelect" class="select-data-button">Select Data</button>
                <!-- Display file name if a file is selected -->
                <p v-if="selectedFile">Selected File: {{ selectedFile.name }}</p>
            </div>

            <!-- URL Input Section -->
            <div v-if="selectedInput === 'url'" class="url-data">
                <input v-model="filePath" type="text" placeholder="Enter URL" class="url-input" />
            </div>

            <div class="buttons">
                <button @click="uploadFile" :disabled="loading" class="process-button">
                    Upload &amp; Process
                </button>
                <button @click="fetchProcessedFiles" :disabled="loading" class="refresh-button">
                    Refresh List
                </button>
            </div>

            <p class="status-message" v-if="message">{{ message }}</p>

            <div class="processed-files" v-if="processedFiles.length">
                <h2>Memories</h2>
                <ul class="memories">
                    <li v-for="(file, index) in processedFiles" :key="index" class="memory">
                        <div class="file-info">
                            <strong>{{ file.fileName }}</strong>
                            <em>(Processed at: {{ file.processedAt }})</em>
                        </div>
                        <button @click="deleteFile(file.filePath)" class="delete-button">
                            Delete Memory
                        </button>
                    </li>
                </ul>
            </div>
        </div>
    </private-view>
</template>

<script setup lang="ts">
import { useApi } from '@directus/extensions-sdk'
import { onMounted, ref } from 'vue'

// Reactive state variables
const filePath = ref('') // For URL-based processing
const selectedFile = ref<File | null>(null) // For file upload handling
const fileInput = ref<HTMLInputElement | null>(null) // Ref for the hidden file input element
const loading = ref(false)
const message = ref('')
const processedFiles = ref<Array<FileMetadata>>([])

// New reactive variable for toggle state
const selectedInput = ref('') // Can be 'file' or 'url'

const api = useApi()

/**
 * Triggered when a file is selected from the hidden file input.
 */
function handleFileChange(event: Event) {
    const target = event.target as HTMLInputElement
    if (target.files && target.files.length) {
        selectedFile.value = target.files[0]!
    } else {
        selectedFile.value = null
    }
}

/**
 * Programmatically triggers the file selection dialog.
 */
function triggerFileSelect() {
    fileInput.value?.click()
}

/**
 * Toggle to the File input. Resets URL and file state if switching.
 */
function selectFileInput() {
    if (selectedInput.value !== 'file') {
        selectedInput.value = 'file'
        filePath.value = ''
        selectedFile.value = null
        if (fileInput.value) {
            fileInput.value.value = ''
        }
    }
}

/**
 * Toggle to the URL input. Resets file and URL state if switching.
 */
function selectUrlInput() {
    if (selectedInput.value !== 'url') {
        selectedInput.value = 'url'
        filePath.value = ''
        selectedFile.value = null
        if (fileInput.value) {
            fileInput.value.value = ''
        }
    }
}

function validateResponse(response) {
    if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    return response
}

/**
 * Uploads the selected file or URL based on toggle selection.
 */
async function uploadFile() {
    if (selectedInput.value === 'file') {
        if (!selectedFile.value) {
            message.value = 'Please select a file.'
            return
        }
    } else if (selectedInput.value === 'url') {
        if (!filePath.value) {
            message.value = 'Please enter a URL.'
            return
        }
    } else {
        message.value = 'Please select an input type: FILE or URL.'
        return
    }

    loading.value = true
    message.value = 'Processing input...'

    try {
        if (selectedInput.value === 'file' && selectedFile.value) {
            // Use FormData for file upload
            const formData = new FormData()
            formData.append('file', selectedFile.value)
            formData.append('chunkSize', '1000')
            formData.append('chunkOverlap', '200')

            const response = validateResponse(await api.post('/rds-vs-endpoint/embed-vector', formData))
            const data = response.data
            message.value = data.message || 'File processed successfully.'
        } else if (selectedInput.value === 'url') {
            // Use JSON payload for URL-based processing
            const response = validateResponse(await api.post('/rds-vs-endpoint/embed-vector', {
                filePath: filePath.value,
                chunkSize: 1000,
                chunkOverlap: 200
            }))
            const data = response.data
            message.value = data.message || 'URL processed successfully.'
        }
        // Reset inputs after processing
        selectedFile.value = null
        filePath.value = ''
        await fetchProcessedFiles()
    } catch (error: any) {
        message.value = `Error processing input: ${error.message}`
    } finally {
        loading.value = false
    }
}

/**
 * Fetches the list of previously processed files.
 */
async function fetchProcessedFiles() {
    try {
        const response = validateResponse(await api.get('/rds-vs-endpoint/get-vectors'))
        const data = response.data
        processedFiles.value = data.files || []
    } catch (error: any) {
        const errorMsg = error.response?.data?.error ||
            error.response?.statusText || // Get server's status text
            error.message ||
            'Unknown error'

        message.value = `Error fetching processed files: ${errorMsg}`
    }
}

/**
 * Deletes a processed file.
 */
async function deleteFile(filePath: string) {
    try {
        loading.value = true
        message.value = 'Deleting file...'

        const response = validateResponse(await api.delete(`/rds-vs-endpoint/del-vector`, { data: { filePath } }))
        const data = response.data
        message.value = data.message || 'File deleted successfully.'

        await fetchProcessedFiles()
    } catch (error: any) {
        message.value = `Error deleting file: ${error.message}`
    } finally {
        loading.value = false
    }
}

// Fetch processed files on component mount
onMounted(async () => {
    await fetchProcessedFiles()
})
</script>

<style lang="scss" scoped>
.agent-panel {
    padding: 1.5rem;
    background: rgba(#fff, 0.1);
    border-radius: 8px;
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    max-width: 600px;
    margin: 2rem auto;

    p {
        text-align: center;
        margin-bottom: 1rem;
    }
}

.input-toggle-buttons {
    display: flex;
    justify-content: center;
    margin-bottom: 1rem;

    button {
        flex: 1;
        padding: 0.75rem;
        margin: 0 0.25rem;
        border: 1px solid #ccc;
        border-radius: 4px;
        background-color: #f0f0f0;
        color: #666;
        cursor: pointer;
        transition: background-color 0.3s, color 0.3s;

        &:hover {
            background-color: #e0e0e0;
        }

        &.active {
            background-color: #007bff;
            color: #fff;
            border-color: #007bff;
        }
    }
}

.file-data,
.url-data {
    text-align: center;
    margin-bottom: 1rem;

    .select-data-button {
        padding: 0.75rem 1.5rem;
        border: 1px solid #007bff;
        border-radius: 4px;
        background-color: #007bff;
        color: #fff;
        cursor: pointer;
        transition: background-color 0.3s;

        &:hover {
            background-color: #0056b3;
        }
    }

    .url-input {
        width: calc(100% - 2rem);
        padding: 0.75rem;
        border: 1px solid #ccc;
        border-radius: 4px;
    }

    p {
        margin-top: 0.5rem;
        font-size: 0.9rem;
        color: #555;
    }
}

.buttons {
    text-align: center;
    margin-top: 1.5rem;

    button {
        padding: 0.75rem 1.5rem;
        margin: 0 0.5rem;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        transition: background-color 0.3s;
    }

    .process-button {
        background-color: rgba(#28a745, 0.3);
        color: #fff;

        &:hover {
            background-color: rgba(#218838, 0.3);
        }
    }

    .refresh-button {
        background-color: rgba(#6c757d, 0.3);
        color: #fff;

        &:hover {
            background-color: rgba(#5a6268, 0.3);
        }
    }
}

.status-message {
    text-align: center;
    margin-top: 1rem;
    font-weight: 500;
}

.processed-files {
    margin-top: 2rem;

    h2 {
        text-align: center;
        margin-bottom: 1rem;
        color: #007bff;
    }

    ul.memories {
        list-style: none;
        padding: 0;

        li.memory {
            background: #f8f9fa;
            margin-bottom: 0.75rem;
            padding: 0.75rem;
            border-radius: 4px;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;

            .file-info {
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                color: #666;

                strong {
                    font-weight: bold;
                }

                em {
                    font-size: 0.85rem;
                    margin-top: 0.25rem;
                }
            }

            .delete-button {
                flex: 0 0 max-content;
                background-color: #dc3545;
                color: #fff;
                border: none;
                border-radius: 4px;
                padding: 0.5rem 1rem;
                cursor: pointer;
                transition: background-color 0.3s;

                &:hover {
                    background-color: #c82333;
                }
            }
        }
    }
}
</style>
