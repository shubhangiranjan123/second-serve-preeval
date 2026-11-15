// Entry point bundled for the Node server (npm run build:core → server/build/core.mjs).
// Only pure logic: no React, no browser APIs.
export { ActionError, applyAction, freshState, isState, withTrust } from './actions'
export type { Action, Actor, Role } from './actions'
export { runMatchingPipeline } from './pipeline'
