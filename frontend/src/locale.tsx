import { createContext, useContext } from "react";
import { translate, type Language } from "./lib/language";
export const LanguageContext = createContext<Language>("zh-Hant");
export function useLanguage() {
  const language = useContext(LanguageContext);
  return { language, t: (text: string) => translate(language, text) };
}
