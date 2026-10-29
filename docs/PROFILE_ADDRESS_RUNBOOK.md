# Atomic profile and default-address operations

AUD-039 makes profile and default-address saves one transaction. The route validates the complete request before writing, locks the current account row, rechecks verification/session version and then writes the permitted profile fields and that account's default address. Any later SQL failure rolls back both halves. Password/role/security changes use the same user-row ordering, and a session revoked before this lock is acquired cannot save through a previously validated snapshot.

Simultaneous saves serialize per account. A first save creates one default; later saves update that same default. Each request contains a complete address, so the final profile/address pair comes from one committed request rather than a mixture. Concurrent edits are last-committed-save behavior, not optimistic conflict/version merging. Address IDs and owners are derived on the server; this endpoint accepts neither from the client.

## Database invariant and upgrade

Migration `20261028220000_atomic_profile_default` installs `Address_one_default_per_user`, a **partial unique index** on userId for rows whose isDefault is true. It enforces at most one default even for SQL or future writers that bypass application locks. Zero defaults and multiple nondefault saved addresses remain valid. A separate userId index supports account-scoped address lookups. The partial index is deliberately maintained in reviewed SQL; preserve it when generating later Prisma migrations. Do not replace migrations with `db push`.

For pre-existing duplicate defaults, the migration retains the most recently updated default per account; ties use most recent creation then ascending ID. Other former defaults become nondefault. **No address row, content field or original timestamp is deleted or rewritten.** This is a deterministic repair of ambiguous flags, not a claim to know the user's preferred address. Review affected accounts and preserve a backup before any production rollout; users can choose a different default once address management is available under AUD-021.

The migration locks Address writes during repair/index creation. Drain old mutation writers and deploy the transaction-aware application with the schema change; an old writer could otherwise save profile fields before an address constraint rejects its separate write. No production migration, deployment or customer-data operation was performed here.

## Frontend behavior

Profile GET and successful saves return only the actual current default for the profile editor. A saved nondefault is not silently presented as a default. Address save uses normalized server-confirmed values, retains user edits on failure, and disables edits/overlapping submits while saving. Fields have associated labels, input bounds and shipping autocomplete hints. There is no preselected district for an account without a saved default. District suggestions are optional text completion, so legitimate districts outside the short suggestion list remain usable.

This editor manages one default. Full address CRUD/selection/checkout integration remains AUD-021; it is not completed by atomic profile saving.

## Verification

Real PostgreSQL cases exercise successful combined save, four simultaneous first saves, exactly one final default/coherent pair, rollback after an executed user write followed by an actual SQL check failure, direct concurrent SQL uniqueness, ownership/ID injection rejection, stale-session denial and a nondefault-only account. The failure constraint exists only in the isolated test database and is removed in finally cleanup. Tests delete only their own address/user fixture rows.

Fresh nine-migration install plus seed and a separate eight-to-nine upgrade rehearsal pass. The upgrade fixture deliberately had three defaults on one account, including timestamp ties, and a separate account's default. Exact JSON comparisons confirmed account/order/history and every address content/timestamp remained equal; only the intended duplicate flags changed. DOM cases verify both normalized successful save and retained edits on failure, including a district outside the suggestions. Provider/browser/production rollout checks remain separately tracked.
