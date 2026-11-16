/**
 * `prism/spec/1` as JSON Schema, for a caller that can hold a model's answer
 * to a schema (constrained decoding, a structured-output API, a tool input).
 *
 * `DRAFT_JSON_SCHEMA` is what a model writes: a title, the fields, the rules
 * and the default answer, and a guarantee only when the user stated one.
 * `completeSpec` (complete.mjs) derives the rest. Whatever satisfies it is a
 * draft `completeSpec` reads; it is deliberately narrower than every draft
 * Prism accepts, so a constrained model has nothing else to write.
 *
 * `SPEC_JSON_SCHEMA` is the whole spec, every member `spec.json` may hold.
 *
 * A schema cannot say everything: that a rule names a field that exists, that
 * a choice is one of its field's values, that `min` is not above `max`. The
 * checker (`checkSpec`) still decides those.
 */
const WORD = { type: 'string', pattern: '^[a-z][a-z0-9-]{0,31}$' };
/** A rule's answer and otherwise: the outcome word itself, never a label for it. */
const ANSWER = { ...WORD, description: 'The answer itself, such as approved: never a label such as result or status. Two or more different answers in all.' };
const WHOLE = { type: 'integer', minimum: 0 };
const TEXT = { type: 'string' };

const CONDITION = {
  type: 'object',
  properties: {
    field: WORD,
    op: { enum: ['is', 'is not', '<', '<=', '>', '>=', '=', '!='] },
    value: { anyOf: [WHOLE, WORD, { type: 'object', properties: { field: WORD }, required: ['field'], additionalProperties: false }] },
  },
  required: ['field', 'op', 'value'],
  additionalProperties: false,
};
const WHEN = { type: 'array', minItems: 1, items: CONDITION };

const closed = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });

const field = (extra = {}) => closed({ name: WORD, kind: { enum: ['number', 'choice'] }, values: { type: 'array', minItems: 2, maxItems: 32, items: WORD }, min: WHOLE, max: WHOLE, ...extra }, ['name', 'kind']);
const fields = (extra) => ({ type: 'array', minItems: 1, maxItems: 8, items: field(extra) });
const rules = (extra = {}) => ({ type: 'array', minItems: 1, maxItems: 24, items: closed({ when: WHEN, then: ANSWER, ...extra }, ['when', 'then']) });
const properties = (extra = {}) => ({ type: 'array', items: closed({ kind: { enum: ['never', 'always'] }, when: WHEN, then: WORD, ...extra }, ['kind', 'when', 'then']) });

/** The draft form: what a model writes. Number bounds are whole and not negative; no member beyond these is allowed. */
export const DRAFT_JSON_SCHEMA = Object.freeze(
  closed({ title: { type: 'string', maxLength: 64 }, fields: fields(), rules: rules(), otherwise: ANSWER, properties: properties() }, ['title', 'fields', 'rules', 'otherwise']),
);

/** The whole spec: every member `prism/spec.json` may hold. */
export const SPEC_JSON_SCHEMA = Object.freeze(
  closed(
    {
      schema: { const: 'prism/spec/1' },
      name: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,62}$' },
      title: { type: 'string', maxLength: 64 },
      purpose: { type: 'string', minLength: 1, maxLength: 200 },
      actors: { type: 'array', items: TEXT },
      limits: { type: 'array', items: TEXT },
      fields: fields({ means: TEXT }),
      outcomes: { type: 'array', minItems: 2, items: WORD },
      meanings: { type: 'object', additionalProperties: TEXT },
      rules: rules({ id: TEXT, says: TEXT, why: TEXT }),
      otherwise: WORD,
      otherwiseWhy: TEXT,
      properties: properties({ id: TEXT, says: TEXT, why: TEXT }),
      examples: { type: 'array', items: closed({ request: TEXT, response: WORD }, ['request', 'response']) },
    },
    ['purpose', 'fields', 'outcomes', 'rules', 'otherwise'],
  ),
);
