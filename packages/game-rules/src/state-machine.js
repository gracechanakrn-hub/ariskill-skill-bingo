import sm from '../../../contracts/round-state-machine.json' with { type: 'json' };

export const ROUND_STATES = Object.keys(sm.round.states);
export const TERMINAL_STATES = sm.round.terminal;
export const PUBLIC_STATE = { DRAFT: 'Waiting', REGISTRATION_OPEN: 'Waiting', LOCKED: 'Waiting', CLOSED: 'Waiting', PLAYING: 'Playing', WINNER: 'Winner', EXHAUSTED: 'Waiting', CANCELLED: 'Waiting' };

export function allowedCommands(state) { return sm.round.states[state]?.commands ?? []; }
export function isCommandAllowed(state, command) { return allowedCommands(state).includes(command); }
export function isTerminal(state) { return TERMINAL_STATES.includes(state); }

/** Possible targets for a (state, command) pair; the game service picks based on guards. */
export function targets(state, command) { return sm.round.transitions.filter(t => t.from === state && t.command === command).map(t => t.to); }

export class IllegalTransition extends Error { constructor(state, command) { super(`command ${command} not allowed in ${state}`); this.code = 'ILLEGAL_TRANSITION'; this.state = state; this.command = command; } }
export function assertAllowed(state, command) { if (!isCommandAllowed(state, command)) throw new IllegalTransition(state, command); }
export const STATE_MACHINE = sm;
