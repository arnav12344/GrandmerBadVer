/*
 * Grandmer — curated question set (FEAT-002).
 *
 * Ages 12-16, non-shaming, immersive "grade the student's paper" framing.
 * Six standard questions cover all five ErrorCategory values across sections,
 * each with a known hidden set of tagged errors. The FINAL question is the
 * essay free-for-all (open marking, no single hidden-error set).
 *
 * Handwritten presentation is a rendering concern (FEAT-003). Here we provide
 * clean data plus exactly which token indices are errors.
 */

import type { AnyQuestion, Token } from "../game/types";

/** Small helper to turn a plain sentence into indexed word tokens. */
function words(sentence: string): Token[] {
  return sentence.split(" ").map((text, index) => ({ index, text }));
}

/**
 * Build tokens from a template where a "▯" marks a punctuation gap (a place a
 * mark is missing). Gaps become empty, `isGap: true` tokens.
 */
function withGaps(parts: string[]): Token[] {
  return parts.map((text, index) =>
    text === "▯"
      ? { index, text: "", isGap: true }
      : { index, text },
  );
}

export const QUESTIONS: readonly AnyQuestion[] = [
  // ---- Section A: Prepositions (word) ----
  {
    kind: "standard",
    id: "q1-prepositions",
    section: "Section A — Prepositions",
    prompt: "Where did the class go on the school trip?",
    // "We arrived to the museum in Monday morning."
    tokens: words("We arrived to the museum in Monday morning."),
    errors: [
      {
        id: "q1-e1",
        category: "preposition",
        kind: "word",
        tokenIndex: 2, // "to"
        fix: "at",
        explanation:
          "We 'arrive at' a place. 'Arrive to' is not correct English.",
        resource: {
          title: "Prepositions of place: arrive at / in",
          url: "https://dictionary.cambridge.org/grammar/british-grammar/arrive",
        },
      },
      {
        id: "q1-e2",
        category: "preposition",
        kind: "word",
        tokenIndex: 5, // "in"
        fix: "on",
        explanation:
          "Use 'on' with days of the week: 'on Monday morning', not 'in Monday'.",
        resource: {
          title: "Prepositions of time: in, on, at",
          url: "https://dictionary.cambridge.org/grammar/british-grammar/at-on-and-in-time",
        },
      },
    ],
  },

  // ---- Section B: Verb tenses (word) ----
  {
    kind: "standard",
    id: "q2-tense",
    section: "Section B — Verb Tenses",
    prompt: "What did you do last weekend?",
    // "Yesterday I go to the park and play football with my friends."
    tokens: words(
      "Yesterday I go to the park and play football with my friends.",
    ),
    errors: [
      {
        id: "q2-e1",
        category: "tense",
        kind: "word",
        tokenIndex: 2, // "go"
        fix: "went",
        explanation:
          "'Yesterday' signals the past, so use the past tense 'went'.",
        resource: {
          title: "Past simple tense",
          url: "https://dictionary.cambridge.org/grammar/british-grammar/past-simple",
        },
      },
      {
        id: "q2-e2",
        category: "tense",
        kind: "word",
        tokenIndex: 7, // "play"
        fix: "played",
        explanation:
          "The action happened in the past, so 'play' becomes 'played'.",
        resource: {
          title: "Past simple tense",
          url: "https://dictionary.cambridge.org/grammar/british-grammar/past-simple",
        },
      },
    ],
  },

  // ---- Section C: Spelling (dropdown) ----
  {
    kind: "standard",
    id: "q3-spelling",
    section: "Section C — Spelling",
    prompt: "Describe your favourite hobby.",
    // "I definately enjoy readng books in the libary after school."
    tokens: words(
      "I definately enjoy readng books in the libary after school.",
    ),
    errors: [
      {
        id: "q3-e1",
        category: "spelling",
        kind: "spelling",
        tokenIndex: 1, // "definately"
        fix: "definitely",
        options: ["definately", "definitely", "definitly", "definetely"],
        explanation:
          "'Definitely' has an 'i' after the 'n': de-fi-nite-ly.",
        resource: {
          title: "Commonly misspelled words",
          url: "https://www.oxfordlearnersdictionaries.com/spellcheck/english/",
        },
      },
      {
        id: "q3-e2",
        category: "spelling",
        kind: "spelling",
        tokenIndex: 3, // "readng"
        fix: "reading",
        options: ["readng", "reading", "readding", "reeding"],
        explanation: "'Reading' keeps the 'i' from 'read' + '-ing'.",
        resource: {
          title: "Adding -ing to verbs",
          url: "https://dictionary.cambridge.org/grammar/british-grammar/spelling",
        },
      },
      {
        id: "q3-e3",
        category: "spelling",
        kind: "spelling",
        tokenIndex: 6, // "libary"
        fix: "library",
        options: ["libary", "library", "librery", "liberry"],
        explanation: "'Library' has two 'r' sounds: lib-ra-ry.",
        resource: {
          title: "Commonly misspelled words",
          url: "https://www.oxfordlearnersdictionaries.com/spellcheck/english/",
        },
      },
    ],
  },

  // ---- Section D: Punctuation (insert marks) ----
  {
    kind: "standard",
    id: "q4-punctuation",
    section: "Section D — Punctuation",
    prompt: "Write a sentence about your morning routine.",
    // "I wake up early ▯ brush my teeth and eat breakfast ▯"
    // Gaps at index 4 (missing comma) and index 9 (missing full stop).
    tokens: withGaps([
      "I",
      "wake",
      "up",
      "early",
      "▯",
      "brush",
      "my",
      "teeth",
      "and",
      "eat",
      "breakfast",
      "▯",
    ]),
    errors: [
      {
        id: "q4-e1",
        category: "punctuation",
        kind: "punctuation",
        tokenIndex: 4, // gap after "early"
        fix: ",",
        explanation:
          "Use a comma to separate items in a list of actions.",
        resource: {
          title: "Using commas",
          url: "https://dictionary.cambridge.org/grammar/british-grammar/punctuation",
        },
      },
      {
        id: "q4-e2",
        category: "punctuation",
        kind: "punctuation",
        tokenIndex: 11, // gap at the end
        fix: ".",
        explanation:
          "Every statement ends with a full stop.",
        resource: {
          title: "End punctuation",
          url: "https://dictionary.cambridge.org/grammar/british-grammar/full-stop-or-period",
        },
      },
    ],
  },

  // ---- Section E: Sentence structure (word) ----
  {
    kind: "standard",
    id: "q5-structure",
    section: "Section E — Sentence Structure",
    prompt: "Tell us about your best friend.",
    // "Me and her is best friends since primary school."
    tokens: words("Me and her is best friends since primary school."),
    errors: [
      {
        id: "q5-e1",
        category: "sentence-structure",
        kind: "word",
        tokenIndex: 0, // "Me"
        fix: "She",
        explanation:
          "Use subject pronouns for the subject: 'She and I', not 'Me and her'.",
        resource: {
          title: "Subject and object pronouns",
          url: "https://dictionary.cambridge.org/grammar/british-grammar/pronouns-personal-i-me-you-him-it-they-etc",
        },
      },
      {
        id: "q5-e2",
        category: "sentence-structure",
        kind: "word",
        tokenIndex: 3, // "is"
        fix: "have been",
        explanation:
          "A plural subject needs a plural verb, and 'since' needs the present perfect: 'have been'.",
        resource: {
          title: "Subject-verb agreement",
          url: "https://dictionary.cambridge.org/grammar/british-grammar/subject-verb-agreement",
        },
      },
    ],
  },

  // ---- Bonus mixed section (spelling + punctuation) ----
  {
    kind: "standard",
    id: "q6-mixed",
    section: "Section F — Mixed Review",
    prompt: "What are you looking forward to this year?",
    // "This year I am realy excited ▯ I want to travel abroad"
    tokens: withGaps([
      "This",
      "year",
      "I",
      "am",
      "realy",
      "excited",
      "▯",
      "I",
      "want",
      "to",
      "travel",
      "abroad",
    ]),
    errors: [
      {
        id: "q6-e1",
        category: "spelling",
        kind: "spelling",
        tokenIndex: 4, // "realy"
        fix: "really",
        options: ["realy", "really", "realley", "reallly"],
        explanation: "'Really' doubles the 'l': real + ly.",
        resource: {
          title: "Adding -ly to adjectives",
          url: "https://dictionary.cambridge.org/grammar/british-grammar/spelling",
        },
      },
      {
        id: "q6-e2",
        category: "punctuation",
        kind: "punctuation",
        tokenIndex: 6, // gap after "excited"
        fix: ".",
        explanation:
          "Two complete thoughts need a full stop between them (or a joining word).",
        resource: {
          title: "Run-on sentences and full stops",
          url: "https://dictionary.cambridge.org/grammar/british-grammar/full-stop-or-period",
        },
      },
    ],
  },

  // ---- Final: Essay free-for-all ----
  {
    kind: "essay",
    id: "q7-essay",
    section: "Section G — Essay (Free Marking)",
    prompt: "In 3-4 sentences, describe a place you would like to visit.",
    text:
      "I would like to visit japan one day. the food looks amazing and I " +
      "always wanted to see the cherry blossom. Me and my family will go " +
      "their when I am older, it will be the best trip ever",
    freeForAll: true,
    focusAreas: [
      "spelling",
      "punctuation",
      "sentence-structure",
      "preposition",
    ],
  },
];

/** All standard (non-essay) questions. */
export const STANDARD_QUESTIONS = QUESTIONS.filter(
  (q): q is Extract<AnyQuestion, { kind: "standard" }> => q.kind === "standard",
);
