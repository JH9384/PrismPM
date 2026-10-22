// Private release-gate acquisition; keep it outside the isolated public helper.
import {captureMetadataEvidence} from './metadata-evidence.mjs';
import {dockerCredentialProvider} from './metadata-credentials.mjs';
import {credentialHelperRunner} from './metadata-helper.mjs';
import {createRegistryTransport} from './metadata-transport.mjs';

export async function captureSdkMetadataEvidence(reference,standards,commands) {
  const credentials=dockerCredentialProvider({runHelper:credentialHelperRunner(commands)});
  return captureMetadataEvidence(reference,standards,createRegistryTransport(reference,credentials));
}
