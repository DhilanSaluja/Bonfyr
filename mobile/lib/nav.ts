import { useCallback, useEffect, useRef } from 'react';
import { BackHandler, InteractionManager, Keyboard } from 'react-native';
import { router, useFocusEffect, useNavigation, type Router } from 'expo-router';

/** Two taps closer together than this are the same intent, not two. */
const GUARD_MS = 700;

type Nav = Pick<Router, 'navigate' | 'back' | 'canGoBack' | 'replace'>;

/**
 * Prefer navigate over push for crew/chat routes.
 *
 * push() always adds a screen. Opening chat from Home, then tapping the
 * header into the crew, then "Open chat" again used to leave
 * [tabs, chat, crew, chat] — the first back looked like a no-op.
 * navigate() pops to an existing match instead of stacking a duplicate.
 */
export function openCrewChat(circleId: string) {
  router.navigate(`/circle/${circleId}/chat`);
}

export function openCrew(circleId: string) {
  router.navigate(`/circle/${circleId}`);
}

/** Run after a Modal starts closing so the next screen is not under a stuck overlay. */
export function afterOverlay(fn: () => void) {
  requestAnimationFrame(() => {
    InteractionManager.runAfterInteractions(() => {
      fn();
    });
  });
}

/**
 * Pop if there is a screen to pop; otherwise land on a real route.
 * `router.back()` with an empty stack is a silent no-op that feels frozen.
 */
export function safeBack(nav: Nav, fallback: string = '/(tabs)') {
  Keyboard.dismiss();
  try {
    if (typeof nav.canGoBack === 'function' && nav.canGoBack()) {
      nav.back();
      return;
    }
  } catch {
    /* navigator not ready */
  }
  nav.replace(fallback as never);
}

/** Disable iOS swipe-back while a Modal is up so the screen under it cannot pop. */
export function useLockBackGesture(locked: boolean) {
  const navigation = useNavigation();
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !locked });
    return () => {
      navigation.setOptions({ gestureEnabled: true });
    };
  }, [navigation, locked]);
}

/** Android hardware back closes the top overlay instead of leaving a stuck Modal. */
export function useCloseOverlaysOnBack(closeTop: () => boolean) {
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => closeTop());
      return () => sub.remove();
    }, [closeTop])
  );
}

/**
 * Swallows repeat presses on navigation controls.
 *
 * Stack pushes are not idempotent: double-tapping "Open chat" used to put two
 * copies of the chat screen on the stack, so the first back press looked like
 * it did nothing. React Navigation doesn't deduplicate this for us because the
 * two pushes are genuinely separate events.
 */
export function useNavGuard() {
  const lastAt = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  return useCallback((action: () => void) => {
    const now = Date.now();
    if (!alive.current || now - lastAt.current < GUARD_MS) return;
    lastAt.current = now;
    action();
  }, []);
}
