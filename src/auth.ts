import { timingSafeEqual } from 'node:crypto';

/**
 * Auth is one function. Nothing else in the server reads anything out of the
 * credential, so v2 can swap this body for JWT validation without touching a
 * caller. See ADR 0003.
 */
export type Validator = (credential: string | undefined) => boolean;

export function makeBearerValidator(expected: string): Validator {
  const expectedBuffer = Buffer.from(expected, 'utf8');

  return (credential) => {
    if (credential === undefined) return false;
    const prefix = 'Bearer ';
    if (!credential.startsWith(prefix)) return false;
    const presented = Buffer.from(credential.slice(prefix.length), 'utf8');
    // timingSafeEqual throws on length mismatch, which itself leaks length;
    // compare lengths first and always run the comparison on equal-length input.
    if (presented.length !== expectedBuffer.length) return false;
    return timingSafeEqual(presented, expectedBuffer);
  };
}
