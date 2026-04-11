import { createI18n } from 'vue-i18n'
import { Converter } from 'opencc-js'
import zh from './locales/zh'
import en from './locales/en'

export type Locale = 'zh' | 'en' | 'zht'

const s2t = Converter({ from: 'cn', to: 'twp' })

function convertDeep(obj: any): any {
  if (typeof obj === 'string') return s2t(obj)
  if (Array.isArray(obj)) return obj.map(convertDeep)
  if (obj && typeof obj === 'object') {
    const out: any = {}
    for (const k of Object.keys(obj)) out[k] = convertDeep(obj[k])
    return out
  }
  return obj
}

const zht = convertDeep(zh)
// 保留语言选择器里的原始标签
zht.settings.language.zh = '简体中文'
zht.settings.language.zht = '繁體中文'
zht.settings.language.en = 'English'
// 简体的语言选择器也加上繁体选项
zh.settings.language.zh = '简体中文'
zh.settings.language.zht = '繁體中文'
en.settings.language.zht = '繁體中文'

export const i18n = createI18n({
  legacy: false,
  locale: 'zh',
  fallbackLocale: 'zh',
  messages: { zh, en, zht },
})

export default i18n
