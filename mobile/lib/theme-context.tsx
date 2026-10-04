import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { darkColors, lightColors, type ThemeColors } from '@/constants/theme';

type Scheme = 'light' | 'dark';

const THEME_KEY = '@bonfire/theme-scheme';

/** Cool ice wash applied on top of the active palette when every fire is out. */
function withIcyTint(base: ThemeColors, scheme: Scheme): ThemeColors {
  if (scheme === 'dark') {
    return {
      ...base,
      paper: '#121820',
      paperDeep: '#0E141C',
      warmWhite: '#1A222C',
      surface: '#182028',
      charcoal: '#C5D4E0',
      charcoalSoft: '#9BB0C2',
      charcoalMuted: '#7A93A8',
      ink: '#E4EEF6',
      dusk: '#D0DCE8',
      lamp: '#7EB8D8',
      lampBtn: '#5A9EBE',
      lampBright: '#A8D4EC',
      lampDeep: '#4A88A8',
      lampSoft: 'rgba(126, 184, 216, 0.22)',
      lampMid: 'rgba(126, 184, 216, 0.36)',
      border: 'rgba(150, 190, 220, 0.22)',
      borderStrong: 'rgba(150, 190, 220, 0.38)',
      lightOff: '#6A8498',
      lightOn: '#A8D4EC',
      ember: '#7EB8D8',
      amber: '#7EB8D8',
      amberGlow: '#A8D4EC',
      amberDeep: '#4A88A8',
      terracotta: '#7EB8D8',
      terracottaSoft: '#A8D4EC',
    };
  }
  return {
    ...base,
    paper: '#E8F2F8',
    paperDeep: '#D5E6F0',
    warmWhite: '#F2F8FC',
    surface: '#F5FAFD',
    charcoal: '#2A3E4C',
    charcoalSoft: '#4A6578',
    charcoalMuted: '#6A8498',
    ink: '#1A2C38',
    dusk: '#243848',
    lamp: '#3D8FB0',
    lampBtn: '#2F7A9A',
    lampBright: '#5AB0D0',
    lampDeep: '#2A6A88',
    lampSoft: 'rgba(61, 143, 176, 0.16)',
    lampMid: 'rgba(61, 143, 176, 0.3)',
    border: 'rgba(90, 140, 170, 0.28)',
    borderStrong: 'rgba(90, 140, 170, 0.45)',
    lightOff: '#8AA4B6',
    lightOn: '#3D8FB0',
    ember: '#3D8FB0',
    amber: '#3D8FB0',
    amberGlow: '#5AB0D0',
    amberDeep: '#2A6A88',
    terracotta: '#3D8FB0',
    terracottaSoft: '#5AB0D0',
  };
}

const ThemeCtx = createContext<{
  colors: ThemeColors;
  scheme: Scheme;
  setScheme: (scheme: Scheme) => void;
  icy: boolean;
  setIcy: (icy: boolean) => void;
}>({
  colors: lightColors,
  scheme: 'light',
  setScheme: () => {},
  icy: false,
  setIcy: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [scheme, setSchemeState] = useState<Scheme>('light');
  const [icy, setIcyState] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY)
      .then((value) => {
        if (value === 'dark' || value === 'light') setSchemeState(value);
      })
      .catch(() => {});
  }, []);

  const setScheme = useCallback((next: Scheme) => {
    setSchemeState(next);
    AsyncStorage.setItem(THEME_KEY, next).catch(() => {});
  }, []);

  /** Avoid no-op updates - flipping icy rebuilds the whole theme and remounts screens. */
  const setIcy = useCallback((next: boolean) => {
    setIcyState((prev) => (prev === next ? prev : next));
  }, []);

  const value = useMemo(() => {
    const base = scheme === 'dark' ? darkColors : lightColors;
    return {
      colors: icy ? withIcyTint(base, scheme) : base,
      scheme,
      setScheme,
      icy,
      setIcy,
    };
  }, [scheme, setScheme, icy, setIcy]);

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useAppTheme() {
  return useContext(ThemeCtx);
}

/** Build StyleSheet.create(...) from live theme colors. Pass a module-level factory. */
export function useThemedStyles<T>(factory: (colors: ThemeColors) => T) {
  const { colors, scheme, setScheme, icy } = useAppTheme();
  const styles = useMemo(() => factory(colors), [colors, factory]);
  return { colors, scheme, setScheme, styles, icy };
}
