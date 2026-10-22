// Closed test-only entry; never included in an application artifact.
import {createPkceS256} from '../../sdk/browser/pkce.mjs';
globalThis.pkceTest = Object.freeze({createPkceS256});
