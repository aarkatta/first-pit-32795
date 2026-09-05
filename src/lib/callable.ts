import { httpsCallable } from 'firebase/functions';
import { getFirebaseServices } from './firebase';

export type CallableInput = Record<string, unknown>;

/**
 * Every privileged mutation goes through a Cloud Functions callable — the client
 * has no write path to a feature collection. This is the single wrapper for all
 * of them; the per-service copies it replaced were byte-identical.
 */
export function call<TInput extends CallableInput, TOutput>(name: string, input: TInput) {
  const { functions } = getFirebaseServices();
  return httpsCallable<TInput, TOutput>(functions, name)(input).then((result) => result.data);
}
