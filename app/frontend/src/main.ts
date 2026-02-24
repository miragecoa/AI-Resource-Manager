import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import LibraryPage from './pages/LibraryPage.vue'
import SettingsPage from './pages/SettingsPage.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/library' },
    { path: '/library', component: LibraryPage },
    { path: '/library/:type', component: LibraryPage },
    { path: '/settings', component: SettingsPage }
  ]
})

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
