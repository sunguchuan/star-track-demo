/**
 * Fab knowledge base: Markdown files in data/kb (runbooks, SOPs, incident reports, specs).
 *
 * Parent-child chunking ("small-to-big"):
 * - parent = one `##` section of a document, the unit returned to the model as context;
 * - child  = a few sentences / list items of that section (≤ CHILD_MAX_CHARS), the unit that
 *   is matched. Small children keep matches precise; parents keep the context complete.
 * Every child carries a contextual header (document title › section heading), so a chunk
 * like "必须低于 2 mTorr/min" still matches a question about wet-clean leak rates.
 *
 * Translations (data/kb/i18n/<lang>/<docId>.md, same `##` sections in the same order) are
 * for display only: retrieval always runs on the source documents, so cross-lingual matching
 * stays the retriever's job, and results are shown in the language of the question.
 */
import { createHash } from "crypto";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

export const KB_DOC_TYPES = ["runbook", "sop", "incident", "spec"] as const;
export type KbDocType = (typeof KB_DOC_TYPES)[number];

export const KB_LANGS = ["zh", "en"] as const;
export type KbLang = (typeof KB_LANGS)[number];

export const CHILD_MAX_CHARS = 180;

export type KbSection = {
  /** `${docId}#${heading}`; stable as long as the heading text is unchanged. */
  id: string;
  docId: string;
  docTitle: string;
  heading: string;
  text: string;
  type: KbDocType;
  codes: string[];
  tools: string[];
  /** Position in the document; translations are matched by it. */
  index: number;
};

export type KbTranslation = {
  title: string;
  sections: { heading: string; text: string }[];
};

export type KbChunk = {
  /** `${sectionId}:${index}` */
  id: string;
  sectionId: string;
  docId: string;
  /** Document title › section heading. */
  header: string;
  text: string;
  /** Content hash; cached vectors are keyed by it, so edited chunks are re-embedded. */
  hash: string;
};

export type KbDoc = {
  id: string;
  title: string;
  type: KbDocType;
  codes: string[];
  tools: string[];
  updated: string | null;
  sections: KbSection[];
};

export type KbCorpus = {
  docs: KbDoc[];
  sections: Map<string, KbSection>;
  chunks: KbChunk[];
  /** docId → language → translation; only translations whose sections line up are kept. */
  translations: Map<string, Partial<Record<KbLang, KbTranslation>>>;
  /** Hash of every file, translations included; part of the answer-cache partition. */
  version: string;
};

export type KbFile = { name: string; source: string };
export type KbTranslationFile = KbFile & { lang: KbLang };

export function kbDir(): string {
  return join(process.cwd(), "data", "kb");
}

const list = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

function parseFrontMatter(source: string): { meta: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { meta: {}, body: source };
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: source.slice(match[0].length) };
}

/** List items, numbered steps and sentences: the pieces children are packed from. */
function splitUnits(text: string): string[] {
  const units: string[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    for (const line of block.split(/\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^(?:[-*]|\d+\.)\s/.test(trimmed)) {
        units.push(trimmed);
        continue;
      }
      const sentences = /[。！？；]/.test(trimmed)
        ? (trimmed.match(/[^。！？；]+[。！？；]?/g) ?? [trimmed])
        : trimmed.split(/(?<=[.!?])\s+/);
      units.push(...sentences.map((s) => s.trim()).filter(Boolean));
    }
  }
  return units;
}

/** Greedy packing; a single unit longer than the limit becomes its own child. */
export function chunkSection(text: string, maxChars = CHILD_MAX_CHARS): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const unit of splitUnits(text)) {
    const joined = current ? `${current}\n${unit}` : unit;
    if (current && joined.length > maxChars) {
      chunks.push(current);
      current = unit;
    } else {
      current = joined;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");

export function parseKbDoc(source: string, fallbackId: string): KbDoc {
  const { meta, body } = parseFrontMatter(source);
  const type = (KB_DOC_TYPES as readonly string[]).includes(meta.type) ? (meta.type as KbDocType) : "sop";
  const doc: KbDoc = {
    id: meta.id || fallbackId,
    title: meta.title || fallbackId,
    type,
    codes: list(meta.codes),
    tools: list(meta.tools),
    updated: meta.updated || null,
    sections: [],
  };
  for (const part of body.split(/^##\s+/m).slice(1)) {
    const newline = part.indexOf("\n");
    const heading = (newline < 0 ? part : part.slice(0, newline)).trim();
    const text = newline < 0 ? "" : part.slice(newline + 1).trim();
    if (!heading || !text) continue;
    doc.sections.push({
      id: `${doc.id}#${heading}`,
      docId: doc.id,
      docTitle: doc.title,
      heading,
      text,
      type: doc.type,
      codes: doc.codes,
      tools: doc.tools,
      index: doc.sections.length,
    });
  }
  return doc;
}

export function chunkDoc(doc: KbDoc): KbChunk[] {
  return doc.sections.flatMap((section) => {
    const header = `${doc.title} › ${section.heading}`;
    return chunkSection(section.text).map((text, i) => ({
      id: `${section.id}:${i}`,
      sectionId: section.id,
      docId: doc.id,
      header,
      text,
      hash: sha1(`${header}\n${text}`),
    }));
  });
}

const stripMd = (name: string) => name.replace(/\.md$/i, "");

export function buildCorpus(files: KbFile[], translationFiles: KbTranslationFile[] = []): KbCorpus {
  const docs = files
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => parseKbDoc(f.source, stripMd(f.name)));
  const sections = new Map<string, KbSection>();
  for (const doc of docs) for (const s of doc.sections) sections.set(s.id, s);

  const byId = new Map(docs.map((d) => [d.id, d]));
  const translations = new Map<string, Partial<Record<KbLang, KbTranslation>>>();
  for (const file of translationFiles) {
    const parsed = parseKbDoc(file.source, stripMd(file.name));
    const source = byId.get(parsed.id);
    if (!source || parsed.sections.length !== source.sections.length) continue;
    translations.set(parsed.id, {
      ...translations.get(parsed.id),
      [file.lang]: {
        title: parsed.title,
        sections: parsed.sections.map((s) => ({ heading: s.heading, text: s.text })),
      },
    });
  }

  const hashed = [
    ...files.map((f) => `${f.name}\n${f.source}`),
    ...translationFiles.map((f) => `${f.lang}/${f.name}\n${f.source}`),
  ];
  return {
    docs,
    sections,
    chunks: docs.flatMap(chunkDoc),
    translations,
    version: sha1(hashed.sort().join("\n")).slice(0, 12),
  };
}

export type LocalizedSection = { docTitle: string; heading: string; text: string; translated: boolean };

/** The section in `lang`, or the source text when there is no translation into it. */
export function localizeSection(corpus: KbCorpus, section: KbSection, lang: KbLang): LocalizedSection {
  const translation = corpus.translations.get(section.docId)?.[lang];
  const part = translation?.sections[section.index];
  if (!translation || !part) {
    return { docTitle: section.docTitle, heading: section.heading, text: section.text, translated: false };
  }
  return { docTitle: translation.title, heading: part.heading, text: part.text, translated: true };
}

export function localizeDoc(corpus: KbCorpus, doc: KbDoc, lang: KbLang): { title: string; headings: string[] } {
  const translation = corpus.translations.get(doc.id)?.[lang];
  return translation
    ? { title: translation.title, headings: translation.sections.map((s) => s.heading) }
    : { title: doc.title, headings: doc.sections.map((s) => s.heading) };
}

const readMarkdown = (dir: string): KbFile[] => {
  try {
    return readdirSync(dir)
      .filter((n) => n.toLowerCase().endsWith(".md"))
      .map((name) => ({ name, source: readFileSync(join(dir, name), "utf8") }));
  } catch {
    return [];
  }
};

let cached: { dir: string; corpus: KbCorpus } | null = null;

/** Read once per process; restart the server after editing data/kb. */
export function loadCorpus(dir = kbDir()): KbCorpus {
  if (cached?.dir === dir) return cached.corpus;
  const i18nDir = join(dir, "i18n");
  const translations = existsSync(i18nDir)
    ? KB_LANGS.flatMap((lang) => readMarkdown(join(i18nDir, lang)).map((f) => ({ ...f, lang })))
    : [];
  const corpus = buildCorpus(readMarkdown(dir), translations);
  cached = { dir, corpus };
  return corpus;
}
