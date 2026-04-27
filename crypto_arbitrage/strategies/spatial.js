/**
 * Spatial Strategy logic (Phase 12).
 * Finds price gaps between different exchanges.
 */
export class SpatialStrategy {
  constructor(adapterA, adapterB) {
    this.adapterA = adapterA;
    this.adapterB = adapterB;
  }

  calculateSpread(askA, bidB, feeA, feeB) {
    const grossSpread = (bidB - askA) / askA;
    const netSpread = grossSpread - (feeA + feeB);
    return { grossSpread, netSpread };
  }
}
