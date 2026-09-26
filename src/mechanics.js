// Default, neutral mechanics. Person B overrides these properties directly
// (see mechanics.config.js) to wire in biometric-driven formulas.
export const Mechanics = {
  calcDamage(baseDamage /*, attacker, defender */) {
    return baseDamage;
  },

  calcFlinchMultiplier(/* defender */) {
    return 1.0;
  },

  healTick(/* player, dtSeconds */) {
    return 0; // no passive regen by default
  },

  meterGain(player, eventType, baseAmount /*, defender */) {
    return baseAmount;
  },

  meterGateOpen(/* player */) {
    return true;
  },
};
