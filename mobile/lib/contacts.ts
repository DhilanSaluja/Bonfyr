import { useCallback, useState } from 'react';
import * as Contacts from 'expo-contacts';
import { phoneHashCandidates } from './utils';
import { matchContactsByPhoneHashes } from './api';

export type MatchedContact = {
  id: string;
  name: string;
  avatar_url: string | null;
  localName: string;
};

export function useContactsSync() {
  const [matched, setMatched] = useState<MatchedContact[]>([]);
  const [loading, setLoading] = useState(false);

  const hasPermission = useCallback(async () => {
    const { status } = await Contacts.getPermissionsAsync();
    return status === 'granted';
  }, []);

  const requestPermission = useCallback(async () => {
    const { status } = await Contacts.requestPermissionsAsync();
    return status;
  }, []);

  const syncContacts = useCallback(async () => {
    setLoading(true);
    try {
      const { status } = await Contacts.getPermissionsAsync();
      if (status !== 'granted') {
        setMatched([]);
        return;
      }

      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers],
      });

      const phones: { number: string; localName: string }[] = [];
      for (const contact of data) {
        if (!contact.phoneNumbers?.length) continue;
        const localName = contact.name?.trim() || 'Contact';
        for (const phone of contact.phoneNumbers) {
          if (!phone.number) continue;
          phones.push({ number: phone.number, localName });
        }
      }

      const hashToLocalName = new Map<string, string>();
      const HASH_PARALLEL = 32;
      for (let i = 0; i < phones.length; i += HASH_PARALLEL) {
        const slice = phones.slice(i, i + HASH_PARALLEL);
        const hashed = await Promise.all(
          slice.map(async ({ number, localName }) => ({
            localName,
            hashes: await phoneHashCandidates(number),
          }))
        );
        for (const { localName, hashes } of hashed) {
          for (const hash of hashes) {
            if (!hashToLocalName.has(hash)) hashToLocalName.set(hash, localName);
          }
        }
      }

      const hashes = [...hashToLocalName.keys()];
      if (hashes.length === 0) {
        setMatched([]);
        return;
      }

      const hits = await matchContactsByPhoneHashes(hashes);
      const seen = new Set<string>();
      const next: MatchedContact[] = [];
      for (const hit of hits) {
        if (seen.has(hit.id)) continue;
        seen.add(hit.id);
        next.push({
          id: hit.id,
          name: hit.name,
          avatar_url: hit.avatar_url,
          localName: hashToLocalName.get(hit.phone_hash) ?? hit.name,
        });
      }
      setMatched(next);
    } finally {
      setLoading(false);
    }
  }, []);

  return { requestPermission, hasPermission, syncContacts, matched, loading };
}
