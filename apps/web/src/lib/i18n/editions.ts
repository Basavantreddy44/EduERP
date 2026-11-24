import type { EditionCode } from '@eduerp/shared';
import type { Lang } from './index';

/**
 * Edition wording (Phase 20 E3). The Residential edition calls a campus a "school" and the whole
 * institution "head office". Instead of a second copy of every message, the normal text is reworded
 * when shown: first the exact texts below, then the word rules (Kannada with its case endings, longest
 * first). Standard text is never touched. New screens are covered automatically.
 */
type Rules = { exact: Record<string, string>; words: [RegExp, string][] };

const RESIDENTIAL: Record<Lang, Rules> = {
  en: {
    exact: {
      'Whole institution': 'Head office (all schools)',
      'School (campus)': 'School',
      'Each asset tag is used once in the whole institution.': 'Each asset tag is used once across all schools.',
      'Choose “Whole institution” for shared offices like Accounts.': 'Choose “Head office (all schools)” for offices that serve every school, like Accounts.',
      'Institution-wide values. Choose a campus in the top bar to set a different value for one campus.': 'Values for every school. Choose a school in the top bar to set a different value for one school.',
      'Add each school or college you run. Students, fees and attendance are all organised by campus.': 'Add each school you run. Students, hostel, meals and attendance are all organised by school.',
    },
    words: [
      [/\bschool \(campus\)/g, 'school'],
      [/\bSchool \(campus\)/g, 'School'],
      [/\bcampuses\b/g, 'schools'],
      [/\bCampuses\b/g, 'Schools'],
      [/\bcampus\b/g, 'school'],
      [/\bCampus\b/g, 'School'],
    ],
  },
  kn: {
    exact: {
      'ಇಡೀ ಸಂಸ್ಥೆ': 'ಮುಖ್ಯ ಕಚೇರಿ (ಎಲ್ಲಾ ಶಾಲೆಗಳು)',
      'ಶಾಲೆ (ಕ್ಯಾಂಪಸ್)': 'ಶಾಲೆ',
      'ಪ್ರತಿ ಆಸ್ತಿ ಟ್ಯಾಗ್ ಇಡೀ ಸಂಸ್ಥೆಯಲ್ಲಿ ಒಮ್ಮೆ ಮಾತ್ರ ಬಳಕೆಯಾಗುತ್ತದೆ.': 'ಪ್ರತಿ ಆಸ್ತಿ ಟ್ಯಾಗ್ ಎಲ್ಲಾ ಶಾಲೆಗಳಲ್ಲಿ ಒಮ್ಮೆ ಮಾತ್ರ ಬಳಕೆಯಾಗುತ್ತದೆ.',
      'ಲೆಕ್ಕಪತ್ರದಂತಹ ಹಂಚಿಕೆಯ ಕಚೇರಿಗಳಿಗೆ “ಇಡೀ ಸಂಸ್ಥೆ” ಆಯ್ಕೆಮಾಡಿ.': 'ಲೆಕ್ಕಪತ್ರದಂತಹ ಎಲ್ಲಾ ಶಾಲೆಗಳ ಕಚೇರಿಗಳಿಗೆ “ಮುಖ್ಯ ಕಚೇರಿ (ಎಲ್ಲಾ ಶಾಲೆಗಳು)” ಆಯ್ಕೆಮಾಡಿ.',
    },
    words: [
      [/ಶಾಲೆ \(ಕ್ಯಾಂಪಸ್\)/g, 'ಶಾಲೆ'],
      [/ಕ್ಯಾಂಪಸ್‌ಗಳಿಗೂ/g, 'ಶಾಲೆಗಳಿಗೂ'],
      [/ಕ್ಯಾಂಪಸ್‌ಗಳಿಗೆ/g, 'ಶಾಲೆಗಳಿಗೆ'],
      [/ಕ್ಯಾಂಪಸ್‌ಗಳನ್ನು/g, 'ಶಾಲೆಗಳನ್ನು'],
      [/ಕ್ಯಾಂಪಸ್‌ಗಳಲ್ಲಿ/g, 'ಶಾಲೆಗಳಲ್ಲಿ'],
      [/ಕ್ಯಾಂಪಸ್‌ಗಳು/g, 'ಶಾಲೆಗಳು'],
      [/ಕ್ಯಾಂಪಸ್‌ಗಳ/g, 'ಶಾಲೆಗಳ'],
      [/ಕ್ಯಾಂಪಸ್‌ನಲ್ಲಿ/g, 'ಶಾಲೆಯಲ್ಲಿ'],
      [/ಕ್ಯಾಂಪಸ್‌ನಿಂದ/g, 'ಶಾಲೆಯಿಂದ'],
      [/ಕ್ಯಾಂಪಸ್‌ನ/g, 'ಶಾಲೆಯ'],
      [/ಕ್ಯಾಂಪಸ್‌ಗೆ/g, 'ಶಾಲೆಗೆ'],
      [/ಕ್ಯಾಂಪಸ್‌ವಾರು/g, 'ಶಾಲಾವಾರು'],
      [/ಕ್ಯಾಂಪಸ್-ಮಾತ್ರ/g, 'ಶಾಲೆ-ಮಾತ್ರ'],
      [/ಕ್ಯಾಂಪಸ್/g, 'ಶಾಲೆ'],
      [/ಆವರಣಗಳಿಗೂ/g, 'ಶಾಲೆಗಳಿಗೂ'],
      [/ಆವರಣಗಳು/g, 'ಶಾಲೆಗಳು'],
      [/ಆವರಣಕ್ಕೆ/g, 'ಶಾಲೆಗೆ'],
      [/ಆವರಣದ/g, 'ಶಾಲೆಯ'],
    ],
  },
};

const RULES: Partial<Record<EditionCode, Record<Lang, Rules>>> = { RESIDENTIAL };
const cache = new Map<string, string>();

/** The text as the edition says it. */
export function editionText(edition: EditionCode, lang: Lang, text: string): string {
  const rules = RULES[edition]?.[lang];
  if (!rules) return text;
  const k = `${edition}|${lang}|${text}`;
  const hit = cache.get(k);
  if (hit !== undefined) return hit;
  let out = rules.exact[text];
  if (out === undefined) {
    out = text;
    for (const [re, to] of rules.words) out = out.replace(re, to);
  }
  if (cache.size > 5000) cache.clear();
  cache.set(k, out);
  return out;
}
