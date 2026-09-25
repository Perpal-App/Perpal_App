/**
 * A failure somewhere between building a transaction and learning what became of it.
 *
 * Its own module, like `DirectWithdrawalError`, because both the legacy and versioned signing paths
 * throw it and both now share a confirmation loop that also throws it. Left in
 * `signedLegacyTransaction`, that shared loop would have had to import from the module that imports it —
 * a cycle, and a cycle in this part of the graph is a Metro module-table failure at the moment a
 * signature is being requested.
 *
 * `signedLegacyTransaction` re-exports it, so every existing importer is unaffected.
 */
export class TransactionSigningError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'TransactionSigningError';
  }
}
