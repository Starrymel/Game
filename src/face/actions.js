// What each face gesture does in the game. Shared by the automatic face control and the tuning panel.
export const ACTIONS = { none: null, punch: ['light', 150], punchNear: ['lightNear', 150], special: ['special', 150], block: ['down', 400], jump: ['up', 200] };
// Names shown in the tuning panel. punchNear only punches when the opponent is within reach (checked by the game).
export const ACTION_LABELS = { none: 'none', punch: 'punch', punchNear: 'punch (only when opponent is near)', special: 'special / laser', block: 'block', jump: 'jump' };
export const LABELS = {
  browsUp: 'Raise eyebrows', smirkRight: 'Smirk: one mouth corner (right)', smirkLeft: 'Smirk: one mouth corner (left)',
  browLeft: 'Raise left eyebrow only', browRight: 'Raise right eyebrow only', blink: 'Long blink (both eyes)',
  winkLeft: 'Wink left eye', winkRight: 'Wink right eye', jawOpen: 'Mouth open', smile: 'Smile',
};
export const DEFAULT_MAP = {
  browsUp: 'special', smirkRight: 'none', smirkLeft: 'none', browLeft: 'none', browRight: 'none',
  blink: 'none', winkLeft: 'none', winkRight: 'none', jawOpen: 'none', smile: 'punchNear',
};
export function actionFor(map, gesture) { return ACTIONS[map?.[gesture]] ?? null; }
