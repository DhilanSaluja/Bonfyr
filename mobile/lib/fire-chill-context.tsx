import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { fetchCrewFiresForUser, fetchUserCircles } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAppTheme } from '@/lib/theme-context';
import { supabase } from '@/lib/supabase';
import { debounce } from '@/lib/utils';

type FireChillValue = {
  icy: boolean;
  setIcy: (next: boolean) => void;
  refreshChill: () => Promise<void>;
};

const FireChillCtx = createContext<FireChillValue>({
  icy: false,
  setIcy: () => {},
  refreshChill: async () => {},
});

/**
 * Watches crew fire status. When every crew fire is out, flips the app into icy mode
 * (cold palette + icicle overlay + sad Bonfyr mark).
 */
export function FireChillProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { icy, setIcy } = useAppTheme();

  const refreshChill = useCallback(async () => {
    if (!user?.id) {
      setIcy(false);
      return;
    }
    try {
      const circles = await fetchUserCircles(user.id);
      if (circles.length === 0) {
        setIcy(false);
        return;
      }
      const fires = await fetchCrewFiresForUser(user.id, circles);
      const allOut = fires.length > 0 && fires.every((row) => !row.fire.isLit);
      setIcy(allOut);
    } catch {
      /* keep last known */
    }
  }, [user?.id, setIcy]);

  useEffect(() => {
    void refreshChill();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshChill();
    });
    return () => sub.remove();
  }, [refreshChill]);

  useEffect(() => {
    if (!user?.id) return;
    const bump = debounce(() => {
      void refreshChill();
    }, 1400);
    const channel = supabase
      .channel(`fire-chill-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'crew_posts' }, bump)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'crew_messages' }, bump)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'opens' }, bump)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, refreshChill]);

  const value = useMemo(
    () => ({ icy, setIcy, refreshChill }),
    [icy, setIcy, refreshChill]
  );

  return <FireChillCtx.Provider value={value}>{children}</FireChillCtx.Provider>;
}

export function useFireChill() {
  return useContext(FireChillCtx);
}
