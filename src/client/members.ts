/**
 * Member writes, as the client exposes them.
 *
 * Kept apart from the transaction operations because they change a different
 * thing: adding or deactivating someone shifts what every future split defaults
 * to, and the group list has to be re-read afterwards rather than one group's
 * transactions.
 */

import type { Db } from "../api/db.js";
import type { Cache } from "../core/cache.js";
import { findMember } from "../core/query.js";
import type { Group, Member, MemberPatch, NewMember } from "../core/types.js";

export interface MemberDeps {
  db(): Promise<Db>;
  cache: Cache;
  group(value: string): Promise<Group>;
}

export function createMemberApi({ db, cache, group }: MemberDeps) {
  return {
    async addMember(value: string, input: NewMember): Promise<Member> {
      const g = await group(value);
      const member = {
        name: input.name,
        active: true,
        defaultWeight: input.defaultWeight ?? "1",
        ...(input.bankAccount ? { bankAccount: input.bankAccount } : {}),
      };
      const id = await (await db()).push(`members/${g.id}`, member);
      // The member list is carried on the group, so the whole list is stale.
      cache.invalidate("groups");
      return { id, ...member };
    },

    async editMember(value: string, member: string, patch: MemberPatch): Promise<Member> {
      const g = await group(value);
      const target = findMember(g.members, member);
      // PATCH rather than PUT: a member row carries a photo and payment handles
      // this kit does not model, and a replace would drop them.
      await (await db()).patch(`members/${g.id}/${target.id}`, patch);
      cache.invalidate("groups");
      return { ...target, ...patch };
    },
  };
}
