
import { defineEndpoint } from '@directus/extensions-sdk'
// import bodyParser from 'body-parser'
import multer from 'multer'
import { RDSVectorStore } from './vs-store.js'

const upload = multer({ dest: './extensions/directus-extension-vector-store/uploads/', preservePath: true })

const VS = new RDSVectorStore()

export default defineEndpoint((router) => {
	// router.use(bodyParser.json())

	router.delete('/del-vector', VS.delete)

	router.get('/get-vectors', VS.get)

	router.post('/embed-vector', upload.single('file'), VS.embed)

	router.get('/health', (_req, res) => res.sendStatus(200))
})

