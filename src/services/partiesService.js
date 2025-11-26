import { supabase } from "../supabaseClient";

const makeId = () =>
  Date.now().toString() + Math.random().toString(36).slice(2);

export async function fetchPartiesRows(userId) {
  const { data, error } = await supabase
    .from("parties")
    .select("id, name")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function fetchPartyAnaajRowsForPartyIds(partyIds) {
  if (!Array.isArray(partyIds) || partyIds.length === 0) return [];
  const { data, error } = await supabase
    .from("party_anaaj")
    .select("party_id, anaaj_id")
    .in("party_id", partyIds);

  if (error) throw error;
  return data || [];
}

export async function createPartyRow(userId, name) {
  const id = makeId();
  const { data, error } = await supabase
    .from("parties")
    .insert([{ id, user_id: userId, name }])
    .select();
  if (error) throw error;
  return data?.[0] || null;
}

export async function renamePartyRow(partyId, newName, userId) {
  const { data: cur, error: e1 } = await supabase
    .from("parties")
    .select("name")
    .eq("id", partyId)
    .single();
  if (e1) throw e1;
  const oldName = cur?.name;

  const { data, error } = await supabase
    .from("parties")
    .update({ name: newName })
    .eq("id", partyId)
    .select();
  if (error) throw error;

  if (oldName && oldName !== newName) {
    const { error: e2 } = await supabase
      .from("purchases")
      .update({ party: newName })
      .match({ user_id: userId, party: oldName });
    if (e2)
      console.error(
        "renamePartyRow: failed to update purchases party names",
        e2
      );
  }

  return data?.[0] || null;
}

export async function deletePartyRow(partyId) {
  const { error } = await supabase
    .from("party_anaaj")
    .delete()
    .eq("party_id", partyId);
  if (error) {
    console.error(
      "deletePartyRow: failed to delete associated party_anaaj",
      error
    );
  }
  const { error: e2 } = await supabase
    .from("parties")
    .delete()
    .eq("id", partyId);
  if (e2) throw e2;
  return true;
}

export async function addPartyAnaajRow(partyId, anaajId) {
  const { data: exists, error: e } = await supabase
    .from("party_anaaj")
    .select("id")
    .match({ party_id: partyId, anaaj_id: anaajId })
    .limit(1)
    .maybeSingle();
  if (e) throw e;
  if (exists) return exists;

  const id = makeId();
  const { data, error } = await supabase
    .from("party_anaaj")
    .insert([{ id, party_id: partyId, anaaj_id: anaajId }])
    .select();
  if (error) throw error;
  return data?.[0] || null;
}

export async function removePartyAnaajRow(partyId, anaajId) {
  const { error } = await supabase
    .from("party_anaaj")
    .delete()
    .match({ party_id: partyId, anaaj_id: anaajId });
  if (error) throw error;
  return true;
}
