import { createI18n } from 'vue-i18n'
import zh from './locales/zh'
import en from './locales/en'

export type Locale = 'zh' | 'en'

export const i18n = createI18n({
  legacy: false,
  locale: 'zh',
  fallbackLocale: 'zh',
  messages: { zh, en },
})

export default i18n
