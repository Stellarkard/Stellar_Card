// Same idea for agent states — one component, zero duplication.

import { Pill } from './Pill';
import { AGENT_STATE_LABEL, AGENT_STATE_PULSING, AGENT_STATE_TONE } from '../_lib/constants';
import type { AgentStateName } from '../_lib/types';

export function AgentStatePill({ state }: { state: AgentStateName }) {
  const label = AGENT_STATE_LABEL[state];
  return (
    <span aria-live="polite" aria-atomic="true">
      <Pill tone={AGENT_STATE_TONE[state]} pulse={AGENT_STATE_PULSING.has(state)} title={label}>
        {label}
      </Pill>
    </span>
  );
}
