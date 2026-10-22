// Independent private adapter checks for the source-owned Semantics model.
// Shape, catalogue selection and enabled controls never authenticate authority.
import {decodePresentationWireValue, encodeWire, validatePresentation, validateIntent,
  progressFits, PRESENTATION_MAXIMUM, PresentationError} from './presentation-wire.mjs';

const fail = code => { throw new PresentationError(code); };
const need = (condition, code = 'shape') => { if (!condition) fail(code); };
const integer = (value, low, high) => Number.isInteger(value) && value >= low && value <= high;
const array = (value, length) => Array.isArray(value) && value.length === length;
const freeze = value => { if (Array.isArray(value)) { value.forEach(freeze); Object.freeze(value); } return value; };

export function validateSemanticPresentation(value) {
  need(array(value, 6) && value[0] === 1 && integer(value[2], 0, 15)
    && integer(value[3], 0, 2) && integer(value[4], 0, 256)
    && Array.isArray(value[5]) && value[5].length <= 256);
  const frame = validatePresentation(value[1]), nodes = frame[6], annotations = value[5];
  const landmarks = new Map();
  let previous = 0;
  for (const annotation of annotations) {
    need(array(annotation, 6) && integer(annotation[0], previous + 1, nodes.length)
      && integer(annotation[1], 0, 8) && integer(annotation[2], 0, 256)
      && integer(annotation[3], 0, 256) && integer(annotation[4], 0, 4)
      && integer(annotation[5], 0, 5), 'binding');
    previous = annotation[0]; landmarks.set(annotation[0], annotation[4]);
  }
  const counts = [0, 0, 0, 0, 0];
  for (const [id, purpose, helper, error, landmark, layout] of annotations) {
    const [parent, content] = nodes[id - 1], kind = content[0];
    need(purpose === 0 || (purpose <= 5 ? kind === 5 : kind === 10), 'binding');
    need((helper === 0 && error === 0) || [5, 6, 7, 10, 11].includes(kind), 'binding');
    need(layout === 0 || kind <= 2, 'binding');
    if (landmark !== 0) {
      need(kind === 0, 'binding'); counts[landmark]++;
      let ancestor = parent, remaining = 16;
      while (ancestor) {
        need(remaining-- > 0, 'limit');
        const node = nodes[ancestor - 1], ancestorLandmark = landmarks.get(ancestor) ?? 0;
        need(node?.[1][0] === 0 && (ancestorLandmark === 0
          || (landmark === 3 && ancestorLandmark === 1)), 'binding');
        ancestor = node[0];
      }
    }
  }
  need(counts[2] <= 1 && counts[4] <= 1, 'binding');
  if (frame[2] === 3 && nodes.length === 0) need(value[4] === 0 && counts[1] === 0, 'binding');
  else need(value[4] > 0 && counts[1] === 1, 'binding');
  return value;
}

export function decodeSemanticPresentation(bytes, maximum = PRESENTATION_MAXIMUM) {
  return freeze(validateSemanticPresentation(decodePresentationWireValue(bytes, maximum)));
}

export function encodeSemanticPresentation(value, maximum = PRESENTATION_MAXIMUM) {
  return encodeWire(validateSemanticPresentation(value), maximum);
}

export function semanticCatalogueFits(value, labelCount, designCount) {
  validateSemanticPresentation(value);
  return integer(labelCount, 1, 256) && integer(designCount, 1, 16)
    && value[2] < designCount && value[4] <= labelCount
    && value[5].every(annotation => annotation[2] <= labelCount && annotation[3] <= labelCount)
    && value[1][3] <= labelCount && value[1][6].every(([, content]) => {
      const kind = content[0];
      if (kind === 4) return true;
      if ((kind === 3 ? content[2] : content[1]) >= labelCount) return false;
      if (kind === 7) return content[5].every(([, label]) => label < labelCount);
      if (kind === 9) return content[2].every(label => label < labelCount);
      return true;
    });
}

export function semanticMainNode(value) {
  validateSemanticPresentation(value);
  return value[5].find(annotation => annotation[4] === 1)?.[0] ?? 0;
}

export function semanticIntentFits(value, intent) {
  validateSemanticPresentation(value);
  return validateIntent(value[1], intent);
}

export function semanticProgressFits(current, next) {
  validateSemanticPresentation(current); validateSemanticPresentation(next);
  return progressFits(current[1], next[1]);
}

// Bootstrap supplies the independently bound catalogue. This copy rejects holes,
// getters and prototype substitutions before retaining any supplied value.
function ownedArray(value, minimum, maximum) {
  need(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype, 'design');
  const descriptors = Object.getOwnPropertyDescriptors(value), length = descriptors.length?.value;
  need(integer(length, minimum, maximum) && Reflect.ownKeys(descriptors).length === length + 1, 'design');
  return Array.from({length}, (_, index) => {
    need(descriptors[index] && Object.hasOwn(descriptors[index], 'value'), 'design');
    return descriptors[index].value;
  });
}

export function captureDesignCatalogue(value) {
  return freeze(ownedArray(value, 1, 16).map(pair => ownedArray(pair, 2, 2).map(tokens => {
    const result = ownedArray(tokens, 16, 16);
    need(result.slice(0, 7).every(color => integer(color, 0, 16777215))
      && integer(result[7], 0, 2)
      && integer(result[8], 1000, 4000) && integer(result[9], 1000, 3000)
      && integer(result[10], 0, 4000) && integer(result[11], 0, 4000)
      && integer(result[12], 16, 120) && integer(result[13], 8, 40)
      && integer(result[14], 20, 100) && integer(result[15], 24, 96), 'design');
    return result;
  })));
}

export function decodeDesignCatalogue(bytes) {
  // 16 pairs * 2 themes * 16 uint32-compatible tokens + canonical array heads.
  // The largest admitted token needs five encoded bytes, but the conservative
  // bound remains independent of particular palette choices.
  return captureDesignCatalogue(decodePresentationWireValue(bytes, 4096));
}
