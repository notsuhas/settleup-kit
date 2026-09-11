/** A small group, shaped like a real one, trimmed to what the tests exercise. */

import type { Group, Member } from "../types.js";

export const alice: Member = {
  id: "m_alice",
  name: "Alice",
  active: true,
  defaultWeight: "1",
};
export const bob: Member = {
  id: "m_bob",
  name: "Bob",
  active: true,
  defaultWeight: "1",
};
/** Someone who left the trip: still a member, but excluded from new splits. */
const carol: Member = {
  id: "m_carol",
  name: "Carol",
  active: false,
  defaultWeight: "1",
};

export const trip: Group = {
  id: "g_trip",
  name: "Trip",
  currencyCode: "INR",
  minimizeDebts: true,
  members: [alice, bob, carol],
  meMemberId: alice.id,
};

/** The same group, but the user is only a spectator — no member of their own. */
export const spectated: Group = { ...trip, meMemberId: undefined };
