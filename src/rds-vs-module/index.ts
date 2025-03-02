import { defineModule } from '@directus/extensions-sdk'
import VStore from './VStore.vue'

export default defineModule({
	id: 'vs-module',
	name: 'Vector Store Module',
	icon: 'psychology',
	routes: [
		{
			path: '',
			component: VStore,
		},
	],
})
