import { defineEndpoint } from '@directus/extensions-sdk'
import multer from 'multer'
import { RDSVectorStore } from './vs-store.js'

const upload = multer({ dest: './extensions/directus-extension-vector-store/uploads/', preservePath: true })

const vs = new RDSVectorStore()

export default defineEndpoint((router) => {
	router.delete('/del-vector', vs.delete)

	router.get('/get-vectors', vs.get)

	router.post('/embed-vector', upload.single('file'), vs.embed)

	router.get('/', (_req, res) => res.sendStatus(200))
})

