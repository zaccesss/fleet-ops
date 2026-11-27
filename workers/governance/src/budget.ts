// a cap on writes per run. Reads are batched through GraphQL and cost a handful of subrequests for
// the whole fleet, but every write (a label, a deleted branch) is one subrequest and how many there
// are depends on how much has drifted. The free Workers plan allows 50 subrequests per invocation,
// so the sweep keeps a margin for its reads and spends the rest on writes. Anything left over waits
// for the next run and is reported once.

export const FREE_PLAN_SUBREQUESTS = 50;
export const READ_RESERVE = 10;

export class WriteBudget {
  private left: number;
  deferred = 0;

  constructor(max = FREE_PLAN_SUBREQUESTS - READ_RESERVE) {
    this.left = max;
  }

  get remaining(): number {
    return this.left;
  }

  // spends n only if all n fit, so a two-step action is never left half done
  spend(n = 1): boolean {
    if (this.left < n) {
      this.deferred += n;
      return false;
    }
    this.left -= n;
    return true;
  }
}
