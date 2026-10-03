/** Reply language for generated content: answer in the language the user asked in. */
export type ReplyLanguage = "zh" | "en";

export const LANGUAGE_NAMES: Record<ReplyLanguage, string> = {
  zh: "Chinese",
  en: "English",
};

const HAN = /\p{Script=Han}/gu;
/** Words made only of letters; IDs like B7, B-240909-01 or ETCH-PARTICLE say nothing about language. */
const LATIN_WORD = /(?<![\w-])[A-Za-z]+(?![\w-])/g;

/**
 * Each Han character carries roughly a word, so compare Han characters with plain Latin words.
 * Input with neither (e.g. just a batch ID) defaults to Chinese, the product's primary language.
 */
export function detectReplyLanguage(text: string): ReplyLanguage {
  const han = text.match(HAN)?.length ?? 0;
  const latinWords = (text.match(LATIN_WORD) ?? []).filter(
    (word) => word.length > 1 && word !== word.toUpperCase(),
  ).length;
  return latinWords > han ? "en" : "zh";
}
