import {encodeWire} from '../../sdk/browser/presentation-wire.mjs';
import {decodeSemanticPresentation} from '../../sdk/browser/semantic-presentation-wire.mjs';

export const labels = ['Application', 'Continue', 'Email', 'Enter a mailbox you control.',
  'Enter a valid email address.', 'Enrollment', 'Main content', 'Recovery code',
  'Skip to main content', 'Welcome'].map((text, index) => ({id: 'label' + String(index).padStart(2, '0'), text}));
export const light = [0xffffff, 0x161616, 0x555555, 0x005fcc, 0xffffff, 0xb00020, 0x005fcc,
  0, 1000, 1500, 1000, 250, 72, 16, 48, 44];
export const dark = [0x121212, 0xffffff, 0xcccccc, 0x9dc4ff, 0x121212, 0xffb4ab, 0x9dc4ff,
  0, 1000, 1500, 1000, 250, 72, 16, 48, 44];
export const designs = [[light, dark]];

// Independently enumerated contract outcomes for actual typed source predicates.
export function predicates() {
  const expectations = [true,false,false,true,true,false,false,true,true,true,false,true,true,false,true,true,false,true,true,false,true,true,false,true,true,false,true,true,false,true,true,false,false,true,true,false,false,true,true,false,true,true,false,true,true,false,false,true,true,false,false,true,true,false,false,true,true,false,false,true,false,true,true,true,false,false,false,true,true,true,false,true,false,true,false,true,false,true,true,false,true,false,true,false,true,false,true,false,true,false,false,false,false];
  const ids = ["DesignValid","DesignTargetUnder","CatalogueEmpty","CatalogueOne","CatalogueBinding","CatalogueLabelsUnder","CatalogueDesignsZero","PresentationValid","surfaceMinimum","surfaceMaximum","surfaceOver","textMinimum","textMaximum","textOver","borderMinimum","borderMaximum","borderOver","accentMinimum","accentMaximum","accentOver","accentTextMinimum","accentTextMaximum","accentTextOver","dangerMinimum","dangerMaximum","dangerOver","focusMinimum","focusMaximum","focusOver","textPermilleMinimum","textPermilleMaximum","textPermilleUnder","textPermilleOver","lineHeightPermilleMinimum","lineHeightPermilleMaximum","lineHeightPermilleUnder","lineHeightPermilleOver","spacePermilleMinimum","spacePermilleMaximum","spacePermilleOver","radiusPermilleMinimum","radiusPermilleMaximum","radiusPermilleOver","contentWidthRemMinimum","contentWidthRemMaximum","contentWidthRemUnder","contentWidthRemOver","sidebarWidthRemMinimum","sidebarWidthRemMaximum","sidebarWidthRemUnder","sidebarWidthRemOver","collapseWidthRemMinimum","collapseWidthRemMaximum","collapseWidthRemUnder","collapseWidthRemOver","targetPixelsMinimum","targetPixelsMaximum","targetPixelsUnder","targetPixelsOver","CatalogueMaximum","CatalogueOver","MainPresent","MainEmpty","ProgressPending","ProgressSameRevision","ProgressBackwards","ProgressReadyNotPending","FontSerif","FontMonospace","CaptionSectionIn","CaptionSectionOut","CaptionNavigationIn","CaptionNavigationOut","CaptionFormIn","CaptionFormOut","CaptionHeadingIn","CaptionHeadingOut","CaptionTextIn","CaptionInputIn","CaptionInputOut","CaptionMultilineIn","CaptionMultilineOut","CaptionSelectIn","CaptionSelectOut","CaptionActionIn","CaptionActionOut","CaptionTableIn","CaptionTableOut","CaptionSecretInputIn","CaptionSecretInputOut","ChoiceCaptionOut","TableHeaderOut","CatalogueBaseHeadingOut"];
  return expectations.map((accepted, index) => ({id: 'Predicate' + ids[index],
    request: Uint8Array.of(index), response: Uint8Array.of(accepted ? 245 : 244)}));
}
export function fixture(revision = 1) {
  return [1, [1, revision, 0, 0, 1, 0, [
    [0, [0, 0]], [1, [3, 1, 9]], [1, [2, 5]],
    [3, [5, 2, true, true, 254, '', 0]],
    [3, [10, 7, true, false, 128, 0]],
    [3, [8, 1, 1, true, true, [4, 5]]],
  ]], 0, 0, 9, [
    [1, 0, 0, 0, 1, 1], [3, 0, 0, 0, 0, 1],
    [4, 4, 4, 0, 0, 0], [5, 8, 0, 0, 0, 0],
  ]];
}

export function corpus() {
  const rows = [];
  const accepted = (id, value) => {
    const request = encodeWire(value); decodeSemanticPresentation(request);
    rows.push({id, request, response: request});
  };
  const rejected = (id, value, code = 9) => {
    const request = encodeWire(value);
    rows.push({id, request, response: Uint8Array.of(0x83, 1, 1, code)});
  };
  accepted('Enrollment', fixture());
  accepted('Closed', [1, [1, 2, 3, 0, 0, 0, []], 0, 0, 0, []]);
  for (let purpose = 0; purpose <= 8; purpose++) {
    const frame = fixture(); frame[5][purpose <= 5 ? 2 : 3][1] = purpose;
    accepted('Purpose' + purpose, frame);
  }
  for (let layout = 0; layout <= 5; layout++) {
    const frame = fixture(); frame[5][0][5] = layout; accepted('Layout' + layout, frame);
  }
  for (let appearance = 0; appearance <= 2; appearance++) {
    const frame = fixture(); frame[3] = appearance; accepted('Appearance' + appearance, frame);
  }
  const error = fixture(); error[5][2][3] = 5; accepted('AssociatedError', error);
  const maximum = fixture(); maximum[2] = 15; maximum[4] = 256;
  maximum[5][2][2] = 256; maximum[5][2][3] = 256; accepted('BoundedReferences', maximum);
  for (const [id, mutate, code] of [
    ['MissingMain', x => { x[5][0][4] = 0; }],
    ['MissingSkip', x => { x[4] = 0; }],
    ['SkipOver', x => { x[4] = 257; }],
    ['DesignOver', x => { x[2] = 16; }],
    ['AnnotationDuplicate', x => { x[5].splice(1, 0, x[5][0]); }],
    ['AnnotationOrder', x => { [x[5][0], x[5][1]] = [x[5][1], x[5][0]]; }],
    ['AnnotationMissingNode', x => { x[5][3][0] = 256; }],
    ['AnnotationZeroNode', x => { x[5][0][0] = 0; }],
    ['PublicSecretPurpose', x => { x[5][2][1] = 6; }],
    ['SecretPublicPurpose', x => { x[5][3][1] = 4; }],
    ['HelperNotField', x => { x[5][0][2] = 1; }],
    ['ErrorNotField', x => { x[5][0][3] = 1; }],
    ['HelperOver', x => { x[5][2][2] = 257; }],
    ['ErrorOver', x => { x[5][2][3] = 257; }],
    ['LandmarkNotSection', x => { x[5][1][4] = 2; }],
    ['LayoutNotStructural', x => { x[5][2][5] = 1; }],
    ['UnknownPurpose', x => { x[5][2][1] = 9; }, 3],
    ['UnknownLandmark', x => { x[5][0][4] = 5; }, 3],
    ['UnknownLayout', x => { x[5][0][5] = 6; }, 3],
    ['UnknownAppearance', x => { x[3] = 3; }, 3],
    ['EnvelopeVersion', x => { x[0] = 2; }, 3],
    ['EnvelopeArityOver', x => { x.push(0); }, 6],
    ['EnvelopeArityUnder', x => { x.pop(); }, 3],
    ['AnnotationArityOver', x => { x[5][0].push(0); }, 6],
    ['AnnotationArityUnder', x => { x[5][0].pop(); }, 3],
    ['AnnotationsOver', x => { x[5] = Array.from({length: 257}, () => [1, 0, 0, 0, 0, 0]); }, 6],
  ]) { const frame = fixture(); mutate(frame); rejected(id, frame, code); }
  const nested = fixture(); nested[1][6].push([1, [0, 0]]); nested[5].push([7, 0, 0, 0, 1, 0]);
  rejected('NestedMain', nested);
  for (const landmark of [2, 4]) {
    const frame = fixture(); frame[1][6].push([0, [0, 0]], [0, [0, 0]]);
    frame[5].push([7, 0, 0, 0, landmark, 0], [8, 0, 0, 0, landmark, 0]);
    rejected('DuplicateLandmark' + landmark, frame);
  }
  const complementary = fixture(); complementary[1][6].push([1, [0, 0]]);
  complementary[5].push([7, 0, 0, 0, 3, 0]); accepted('ComplementaryInsideMain', complementary);
  for (const landmark of [2, 3, 4]) {
    const frame = fixture(); frame[1][6].push([0, [0, 0]]);
    frame[5].push([7, 0, 0, 0, landmark, 0]); accepted('TopLevelLandmark' + landmark, frame);
  }
  for (const landmark of [1, 2, 4]) {
    const frame = structuredClone(complementary); frame[5][4][4] = landmark;
    rejected('NestedGlobalLandmark' + landmark, frame);
  }
  const bytes = encodeWire(fixture());
  rows.push({id: 'Trailing', request: Uint8Array.from([...bytes, 0]), response: Uint8Array.of(0x83, 1, 1, 8)});
  rows.push({id: 'Noncanonical', request: Uint8Array.from([0x98, 6, ...bytes.slice(1)]), response: Uint8Array.of(0x83, 1, 1, 5)});
  for (let length = 0; length < bytes.length; length++) {
    rows.push({id: 'Truncated' + length, request: bytes.slice(0, length), response: Uint8Array.of(0x83, 1, 1, 2)});
  }
  return rows;
}
