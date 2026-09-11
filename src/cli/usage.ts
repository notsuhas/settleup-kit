export const USAGE = `settleup — unofficial Settle Up client

  Set SETTLEUP_EMAIL and SETTLEUP_PASSWORD, then:

    settleup login                    sign in once and cache the token
    settleup whoami                   the signed-in user and their groups

  Reading

    settleup groups                   every group, with its members
    settleup members  --group Lisbon
    settleup list     --group Lisbon [--purpose ramen] [--type expense]
                                     [--after 2026-09-01] [--before 2026-09-30]
                                     [--min 500] [--max 5000] [--limit 20]
    settleup balances --group Lisbon   who owes whom

  Writing

    settleup add --group Lisbon --amount 3200 --purpose "Dinner" \\
                 [--currency EUR] [--category 🍽] [--date 2026-09-11] \\
                 [--paid-by Bob] [--for "Alice,Bob"]

    settleup pay --group Lisbon --amount 1000 --to Alice [--from Bob]

    settleup edit <id> --group Lisbon [--amount …] [--purpose …] [--for …]
    settleup rm   <id> --group Lisbon

  Groups and members

    settleup new-group   --name "Lisbon 2026" --currency EUR \\
                         --members "Alice,Bob"     first member is you
    settleup edit-group  --group "Lisbon 2026" --name "Lisbon trip"
    settleup add-member  --group Lisbon --name Carol
    settleup edit-member <name> --group Lisbon [--name …] [--active|--inactive]

  Notes

    An expense defaults to being paid by you and split equally between every
    active member. --for and --paid-by take comma-separated names.

    A description is required: Settle Up rejects an empty one with a bare
    "Permission denied".

    Amounts are always positive; direction comes from add vs pay.

  Flags

    --json                machine-readable output on any command
    --sandbox             use Settle Up's sandbox instead of the live account
    --force               with login, ignore the cached token
`;
