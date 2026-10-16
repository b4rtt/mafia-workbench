// HUMAN_CANDIE is a verified no-op in the supported original GOG executable.
// First N actor registers contain distinct waiting answer detectors, N = 2..4.
export const choiceMenuMarkerBase = 0x57424300;
// dim_flt >= 1: flt[0] becomes 0 if not ready, 1 after the native menu returns
// (Exit included). The original executable leaves a caller sentinel untouched.
export const choiceMenuStatusMarkerBase = choiceMenuMarkerBase + 0x10;
