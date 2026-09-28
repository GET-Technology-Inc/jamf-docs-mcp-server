/**
 * What Jamf's documentation maps are, by its two labels for a kind of
 * document: the `content-*` values of `zoominmetadata`, and `jamf:contentType`.
 * Captured from `GET https://learn.jamf.com/api/khub/maps` on 2026-09-28 at
 * 13:17 UTC, 685 maps.
 *
 * Each row is the maps of one locale that carry exactly these `content-*`
 * labels and these `jamf:contentType` values, in the order Jamf lists them,
 * and how many there are. Nothing else of a map is kept.
 *
 * What the rows show: every `content-*` label is paired with one
 * `jamf:contentType` value in each locale, translated as `jamf:contentType`
 * is. A map labelled `content-training` carries "Training Content" in en-US
 * and its translation elsewhere (16 in en-US, one each in de-DE, es-ES,
 * fr-FR, ja-JP and zh-TW), and no map without the label carries one of those.
 * A map with two labels carries both values. The eight maps in it-IT, pt-BR,
 * th-TH and zh-CN carry no `jamf:contentType` at all.
 */

import type { FtMapInfo } from '../../src/core/types.js';

export interface MapContentTypesRow {
  locale: string;
  labelKeys: readonly string[];
  contentTypes: readonly string[];
  maps: number;
}

export const MAPS_CONTENT_TYPES: readonly MapContentTypesRow[] = [
  { locale: 'de-DE', labelKeys: ['content-gettingstarted'], contentTypes: ['Erste Schritte'], maps: 1 },
  { locale: 'de-DE', labelKeys: ['content-releasenotes'], contentTypes: ['Versionshinweise'], maps: 5 },
  { locale: 'de-DE', labelKeys: ['content-techdocs', 'content-gettingstarted'], contentTypes: ['Technische Dokumentation', 'Erste Schritte'], maps: 1 },
  { locale: 'de-DE', labelKeys: ['content-techdocs', 'content-releasenotes'], contentTypes: ['Technische Dokumentation', 'Versionshinweise'], maps: 21 },
  { locale: 'de-DE', labelKeys: ['content-techdocs', 'content-solutionguide'], contentTypes: ['Technische Dokumentation', 'Leitfaden zur Lösung'], maps: 1 },
  { locale: 'de-DE', labelKeys: ['content-techdocs'], contentTypes: ['Technische Dokumentation'], maps: 64 },
  { locale: 'de-DE', labelKeys: ['content-training'], contentTypes: ['Schulungsinhalt'], maps: 1 },
  { locale: 'en-US', labelKeys: ['content-gettingstarted'], contentTypes: ['Getting Started Guide'], maps: 1 },
  { locale: 'en-US', labelKeys: ['content-glossary'], contentTypes: ['Glossary'], maps: 1 },
  { locale: 'en-US', labelKeys: ['content-releasenotes'], contentTypes: ['Release Notes'], maps: 7 },
  { locale: 'en-US', labelKeys: ['content-solutionguide'], contentTypes: ['Solution Guide'], maps: 3 },
  { locale: 'en-US', labelKeys: ['content-techdocs', 'content-gettingstarted'], contentTypes: ['Technical Documentation', 'Getting Started Guide'], maps: 1 },
  { locale: 'en-US', labelKeys: ['content-techdocs', 'content-releasenotes'], contentTypes: ['Technical Documentation', 'Release Notes'], maps: 46 },
  { locale: 'en-US', labelKeys: ['content-techdocs', 'content-solutionguide'], contentTypes: ['Technical Documentation', 'Solution Guide'], maps: 2 },
  { locale: 'en-US', labelKeys: ['content-techdocs'], contentTypes: ['Technical Documentation'], maps: 123 },
  { locale: 'en-US', labelKeys: ['content-training'], contentTypes: ['Training Content'], maps: 16 },
  { locale: 'es-ES', labelKeys: ['content-gettingstarted'], contentTypes: ['Empezar'], maps: 1 },
  { locale: 'es-ES', labelKeys: ['content-releasenotes'], contentTypes: ['Notas de publicación'], maps: 5 },
  { locale: 'es-ES', labelKeys: ['content-techdocs', 'content-gettingstarted'], contentTypes: ['Documentación técnica', 'Empezar'], maps: 1 },
  { locale: 'es-ES', labelKeys: ['content-techdocs', 'content-releasenotes'], contentTypes: ['Documentación técnica', 'Notas de publicación'], maps: 21 },
  { locale: 'es-ES', labelKeys: ['content-techdocs', 'content-solutionguide'], contentTypes: ['Documentación técnica', 'Guía de soluciones'], maps: 1 },
  { locale: 'es-ES', labelKeys: ['content-techdocs'], contentTypes: ['Documentación técnica'], maps: 64 },
  { locale: 'es-ES', labelKeys: ['content-training'], contentTypes: ['Contenido de formación'], maps: 1 },
  { locale: 'fr-FR', labelKeys: ['content-gettingstarted'], contentTypes: ['Premiers pas'], maps: 1 },
  { locale: 'fr-FR', labelKeys: ['content-releasenotes'], contentTypes: ['Notes de version'], maps: 5 },
  { locale: 'fr-FR', labelKeys: ['content-techdocs', 'content-gettingstarted'], contentTypes: ['Documentation technique', 'Premiers pas'], maps: 1 },
  { locale: 'fr-FR', labelKeys: ['content-techdocs', 'content-releasenotes'], contentTypes: ['Documentation technique', 'Notes de version'], maps: 21 },
  { locale: 'fr-FR', labelKeys: ['content-techdocs', 'content-solutionguide'], contentTypes: ['Documentation technique', 'Guide des solutions'], maps: 1 },
  { locale: 'fr-FR', labelKeys: ['content-techdocs'], contentTypes: ['Documentation technique'], maps: 65 },
  { locale: 'fr-FR', labelKeys: ['content-training'], contentTypes: ['Contenu de la formation'], maps: 1 },
  { locale: 'it-IT', labelKeys: ['content-techdocs'], contentTypes: [], maps: 2 },
  { locale: 'ja-JP', labelKeys: ['content-gettingstarted'], contentTypes: ['はじめに'], maps: 1 },
  { locale: 'ja-JP', labelKeys: ['content-releasenotes'], contentTypes: ['リリースノート'], maps: 5 },
  { locale: 'ja-JP', labelKeys: ['content-techdocs', 'content-gettingstarted'], contentTypes: ['テクニカル資料', 'はじめに'], maps: 1 },
  { locale: 'ja-JP', labelKeys: ['content-techdocs', 'content-releasenotes'], contentTypes: ['テクニカル資料', 'リリースノート'], maps: 21 },
  { locale: 'ja-JP', labelKeys: ['content-techdocs', 'content-solutionguide'], contentTypes: ['テクニカル資料', 'ソリューションガイド'], maps: 1 },
  { locale: 'ja-JP', labelKeys: ['content-techdocs'], contentTypes: ['テクニカル資料'], maps: 64 },
  { locale: 'ja-JP', labelKeys: ['content-training'], contentTypes: ['トレーニングコンテンツ'], maps: 1 },
  { locale: 'nl-NL', labelKeys: ['content-releasenotes'], contentTypes: ['Release-opmerkingen'], maps: 1 },
  { locale: 'nl-NL', labelKeys: ['content-techdocs'], contentTypes: ['Technische documentatie'], maps: 10 },
  { locale: 'pt-BR', labelKeys: ['content-techdocs'], contentTypes: [], maps: 2 },
  { locale: 'th-TH', labelKeys: ['content-techdocs'], contentTypes: [], maps: 2 },
  { locale: 'zh-CN', labelKeys: ['content-techdocs'], contentTypes: [], maps: 2 },
  { locale: 'zh-TW', labelKeys: ['content-gettingstarted'], contentTypes: ['入門指南'], maps: 1 },
  { locale: 'zh-TW', labelKeys: ['content-releasenotes'], contentTypes: ['版本資訊'], maps: 4 },
  { locale: 'zh-TW', labelKeys: ['content-techdocs', 'content-gettingstarted'], contentTypes: ['技術說明文件', '入門指南'], maps: 1 },
  { locale: 'zh-TW', labelKeys: ['content-techdocs', 'content-releasenotes'], contentTypes: ['技術說明文件', '版本資訊'], maps: 21 },
  { locale: 'zh-TW', labelKeys: ['content-techdocs', 'content-solutionguide'], contentTypes: ['技術說明文件', '解決方案指南'], maps: 1 },
  { locale: 'zh-TW', labelKeys: ['content-techdocs'], contentTypes: ['技術說明文件'], maps: 60 },
  { locale: 'zh-TW', labelKeys: ['content-training'], contentTypes: ['培訓內容'], maps: 1 },
];

/**
 * The rows as a maps list, one map for each map a row counts, carrying its
 * row's locale, labels and content types. Each map is a publication of its
 * own, so that nothing but these two labels ties one map to another.
 */
export function mapsWithContentTypes(): FtMapInfo[] {
  return MAPS_CONTENT_TYPES.flatMap((row, r) => Array.from({ length: row.maps }, (_, i): FtMapInfo => {
    const id = `content-types-${String(r)}-${String(i)}`;
    return {
      id,
      title: id,
      mapApiEndpoint: `/api/khub/maps/${id}`,
      metadata: [
        { key: 'bundle', label: 'bundle', values: [id] },
        { key: 'ft:locale', label: 'ft:locale', values: [row.locale] },
        { key: 'zoominmetadata', label: 'zoominmetadata', values: [...row.labelKeys] },
        { key: 'jamf:contentType', label: 'Content Type', values: [...row.contentTypes] },
      ],
    };
  }));
}
