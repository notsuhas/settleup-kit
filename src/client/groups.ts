/**
 * Creating and editing groups.
 *
 * Creation is the one operation that is not a single write. A group is spread
 * across four nodes, and they have to be written in an order the security
 * rules accept:
 *
 *   1. `permissions/<id>/<uid>` — grants the caller level 30 on a group that
 *      does not exist yet. Nothing else is writable until this is in place.
 *   2. `groups/<id>` — the group itself, which is **rejected without an
 *      `inviteLinkHash`**. That one missing field is what makes a hand-rolled
 *      create fail with a bare "Permission denied"; see docs/traps.md.
 *   3. `members/<id>/…` — one per person.
 *   4. `userGroups/<uid>/<id>` — makes the group visible to the user, and
 *      records which member they are. Written last, so a half-built group
 *      never appears in the app.
 *
 * Because step 1 needs the id before anything exists, the id is generated
 * locally rather than by a POST.
 */

import type { Db } from "../api/db.js";
import type { Cache } from "../core/cache.js";
import { inviteHash, pushId } from "../core/pushid.js";
import type { Group, GroupPatch, NewGroup } from "../core/types.js";
import { SettleUpError } from "../core/types.js";

/** The app's own default, and a reasonable one: fewest transfers to settle up. */
const DEFAULT_COLOR = "#4CAF50";

export interface GroupDeps {
  db(): Promise<Db>;
  uid(): Promise<string>;
  cache: Cache;
  group(value: string): Promise<Group>;
}

export function createGroupApi({ db, uid, cache, group }: GroupDeps) {
  return {
    async createGroup(input: NewGroup): Promise<Group> {
      if (!input.name.trim()) throw new SettleUpError("a group needs a name");
      const names = input.members?.length ? input.members : ["Me"];

      const database = await db();
      const user = await uid();
      const id = pushId();
      const hash = inviteHash();
      const color = input.color ?? DEFAULT_COLOR;

      await database.put(`permissions/${id}/${user}`, { level: 30 });

      await database.put(`groups/${id}`, {
        name: input.name,
        convertedToCurrency: input.currencyCode,
        minimizeDebts: input.minimizeDebts ?? true,
        remindOldDebts: true,
        ownerColor: color,
        defaultPermission: 20,
        // Required. Without these the write is refused.
        inviteLink: `https://join.settleup.app/${hash}`,
        inviteLinkHash: hash,
        inviteLinkActive: true,
      });

      const members = [];
      for (const name of names) {
        const memberId = await database.push(`members/${id}`, {
          name,
          active: true,
          defaultWeight: "1",
        });
        members.push({ id: memberId, name, active: true, defaultWeight: "1" });
      }

      // The first member is the caller's own, which is what "who paid" defaults
      // to. Written last: until this exists the group is invisible.
      const me = members[0] as { id: string };
      await database.put(`userGroups/${user}/${id}`, {
        member: me.id,
        order: Date.now() % 100_000,
        color,
      });

      cache.invalidate("groups");
      return {
        id,
        name: input.name,
        currencyCode: input.currencyCode,
        minimizeDebts: input.minimizeDebts ?? true,
        inviteLink: `https://join.settleup.app/${hash}`,
        members,
        meMemberId: me.id,
      };
    },

    /**
     * Delete a group and everything in it.
     *
     * The order is load-bearing. `permissions/<id>/<uid>` is what authorises
     * every other write, so it goes **last** — remove it first and the rest
     * becomes unreachable, leaving a group nobody can see or clean up. That is
     * not hypothetical; it is how this was found.
     *
     * `/debts/<id>` is deliberately not touched: it is server-owned and refuses
     * a client delete, and it stops mattering once the transactions are gone.
     */
    async deleteGroup(value: string): Promise<Group> {
      const g = await group(value);
      const database = await db();
      const user = await uid();

      await database.delete(`transactions/${g.id}`);
      await database.delete(`members/${g.id}`);
      await database.delete(`groups/${g.id}`);
      await database.delete(`userGroups/${user}/${g.id}`);
      await database.delete(`permissions/${g.id}`);

      cache.invalidate("groups");
      cache.invalidate(`tx:${g.id}`);
      cache.invalidate(`debts:${g.id}`);
      return g;
    },

    /**
     * Rename a group, change its currency, or toggle debt minimisation.
     *
     * PATCH rather than PUT: `lastChanged` is server-managed and a group also
     * carries the invite link and premium fields this kit does not model, all
     * of which a replace would destroy.
     */
    async editGroup(value: string, patch: GroupPatch): Promise<Group> {
      const g = await group(value);
      const body = {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.currencyCode !== undefined ? { convertedToCurrency: patch.currencyCode } : {}),
        ...(patch.minimizeDebts !== undefined ? { minimizeDebts: patch.minimizeDebts } : {}),
      };
      if (Object.keys(body).length === 0) {
        throw new SettleUpError("nothing to change — pass at least one field");
      }
      await (await db()).patch(`groups/${g.id}`, body);
      cache.invalidate("groups");
      return { ...g, ...patch };
    },
  };
}
