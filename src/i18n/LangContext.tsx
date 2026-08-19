import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { translate, translateMsg, type Lang, type Msg } from "./index";

interface LangApi {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** Translate a key with optional parameters. */
  t: (key: string, p?: Record<string, string | number>) => string;
  /** Translate a structured message emitted by the simulation core. */
  tm: (m: Msg) => string;
}

const LangCtx = createContext<LangApi | null>(null);

const STORAGE_KEY = "airbase-sim-lang";

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "sv") return saved;
  } catch {
    // Storage can be unavailable (private mode, embedded frame) — not fatal.
  }
  // English by default, deliberately, even for a Swedish browser: the domain
  // vocabulary is Swedish but the audience is not necessarily.
  return "en";
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  // Keep the document in sync so non-context consumers (and screen readers) agree.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore
    }
    document.documentElement.lang = l;
  }, []);

  const api = useMemo<LangApi>(
    () => ({
      lang,
      setLang,
      t: (key, p) => translate(lang, key, p),
      tm: (m) => translateMsg(lang, m),
    }),
    [lang, setLang],
  );

  return <LangCtx.Provider value={api}>{children}</LangCtx.Provider>;
}

export function useLang(): LangApi {
  const ctx = useContext(LangCtx);
  if (!ctx) throw new Error("useLang must be used inside <LangProvider>");
  return ctx;
}
