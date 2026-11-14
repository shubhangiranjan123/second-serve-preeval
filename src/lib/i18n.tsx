import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { STRINGS } from './strings'

export type Lang = 'en' | 'hi' | 'pa'

export const LANGS: Array<{ id: Lang; label: string; name: string }> = [
  { id: 'en', label: 'EN', name: 'English' },
  { id: 'hi', label: 'हि', name: 'हिन्दी' },
  { id: 'pa', label: 'ਪੰ', name: 'ਪੰਜਾਬੀ' },
]

type Vars = Record<string, string | number>

type Ctx = {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: string, vars?: Vars) => string
}

const KEY = 'second-serve-lang'

function fill(text: string, vars?: Vars) {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] !== undefined ? String(vars[k]) : m))
}

function translate(lang: Lang, key: string, vars?: Vars) {
  if (lang === 'en') return fill(key, vars)
  const row = STRINGS[key]
  const text = row ? (lang === 'hi' ? row[0] : row[1]) : key
  return fill(text, vars)
}

const LangContext = createContext<Ctx>({
  lang: 'en',
  setLang: () => undefined,
  t: (key, vars) => fill(key, vars),
})

function readLang(): Lang {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'hi' || v === 'pa' ? v : 'en'
  } catch {
    return 'en'
  }
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang)

  useEffect(() => {
    document.documentElement.lang = lang === 'en' ? 'en' : lang === 'hi' ? 'hi' : 'pa'
    document.documentElement.dataset.lang = lang
  }, [lang])

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setLangState(readLang())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try {
      localStorage.setItem(KEY, l)
    } catch {
      return
    }
  }, [])

  const t = useCallback((key: string, vars?: Vars) => translate(lang, key, vars), [lang])
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t])
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}

export function useT() {
  return useContext(LangContext)
}

export function T({ k, vars }: { k: string; vars?: Vars }) {
  const { t } = useT()
  return <>{t(k, vars)}</>
}
