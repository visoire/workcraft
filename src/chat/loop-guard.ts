// Stops an answer that keeps making the same failing tool call. Small local models in particular repeat a call
// with identical arguments after an error; each repeat would ask the user again. No DOM.

/** The same call failing this often ends the answer. */
export const MAX_SAME_FAILURES = 3;

export class FailureGuard {
  private counts = new Map<string, number>();
  /** Name of the tool whose call hit the limit, or null */
  stuck: string | null = null;

  private key(name: string, args: unknown): string {
    return `${name}:${JSON.stringify(args)}`;
  }

  /** True when this call (tool and arguments) already failed the maximum number of times: do not run it again. */
  blocked(name: string, args: unknown): boolean {
    if ((this.counts.get(this.key(name, args)) || 0) < MAX_SAME_FAILURES) return false;
    this.stuck = name;
    return true;
  }

  /** Records a failed run; the maximum ends the answer after the current round. */
  failed(name: string, args: unknown): void {
    const k = this.key(name, args);
    const n = (this.counts.get(k) || 0) + 1;
    this.counts.set(k, n);
    if (n >= MAX_SAME_FAILURES) this.stuck = name;
  }

  reset(): void {
    this.counts.clear();
    this.stuck = null;
  }
}
