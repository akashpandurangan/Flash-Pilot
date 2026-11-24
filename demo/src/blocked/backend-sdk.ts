/**
 * Stand-in for the backend SDK. The demo build aliases the SDK's package name to this file, so even a stray value import
 * could never pull the real client into the bundle - it gets this, which refuses to do anything.
 */
const refuse = (): never => {
  throw new Error('The interactive demo has no backend connection.')
}

export const createClient = refuse
export default { createClient: refuse }
